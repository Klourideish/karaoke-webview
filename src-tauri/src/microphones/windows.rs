use std::ffi::c_void;

use windows::{
    core::{HRESULT, PWSTR},
    Win32::{
        Devices::FunctionDiscovery::PKEY_Device_FriendlyName,
        Media::Audio::{
            eCapture, eConsole, IMMDevice, IMMDeviceEnumerator, MMDeviceEnumerator, DEVICE_STATE,
            DEVICE_STATEMASK_ALL, DEVICE_STATE_ACTIVE,
        },
        System::Com::StructuredStorage::{PropVariantClear, PropVariantToStringAlloc, PROPVARIANT},
        System::Com::{
            CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_ALL,
            COINIT_MULTITHREADED, STGM_READ,
        },
    },
};

use super::discovery::{DiscoveryError, PlatformDiscovery, PlatformMicrophoneSource};

const RPC_E_CHANGED_MODE: HRESULT = HRESULT(0x80010106u32 as i32);

pub(super) fn discover_windows_microphones() -> Result<PlatformDiscovery, DiscoveryError> {
    let _apartment = ComApartment::initialize()?;

    // SAFETY: COM is initialized for this thread, and the returned interfaces own their lifetimes.
    let enumerator: IMMDeviceEnumerator = unsafe {
        CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).map_err(|error| {
            DiscoveryError::platform(
                "Could not create the Windows audio endpoint enumerator.",
                error,
            )
        })?
    };

    let default_platform_id = default_capture_id(&enumerator);
    // SAFETY: The enumerator is valid and the state mask requests endpoint metadata only.
    let collection = unsafe {
        enumerator
            .EnumAudioEndpoints(eCapture, DEVICE_STATE(DEVICE_STATEMASK_ALL))
            .map_err(|error| {
                DiscoveryError::platform("Could not enumerate Windows microphone endpoints.", error)
            })?
    };
    // SAFETY: The collection is a valid COM interface.
    let count = unsafe { collection.GetCount() }.map_err(|error| {
        DiscoveryError::platform("Could not count Windows microphone endpoints.", error)
    })?;

    let mut sources = Vec::with_capacity(count as usize);
    for index in 0..count {
        // SAFETY: index is bounded by the collection count.
        let device = match unsafe { collection.Item(index) } {
            Ok(device) => device,
            Err(error) => {
                eprintln!("Could not inspect Windows microphone endpoint {index}. {error}");
                continue;
            }
        };

        let platform_id = match device_id(&device) {
            Ok(id) => id,
            Err(error) => {
                eprintln!("Could not read Windows microphone endpoint identity. {error}");
                continue;
            }
        };
        let display_name = device_display_name(&device).unwrap_or_else(|error| {
            eprintln!("Could not read Windows microphone endpoint name. {error}");
            "Unnamed microphone".to_string()
        });
        // SAFETY: The device is a valid endpoint interface and GetState reads metadata only.
        let available = unsafe { device.GetState() }
            .map(|state| state == DEVICE_STATE_ACTIVE)
            .unwrap_or(false);

        sources.push(PlatformMicrophoneSource {
            platform_id,
            display_name,
            available,
        });
    }

    Ok(PlatformDiscovery {
        sources,
        default_platform_id,
    })
}

fn default_capture_id(enumerator: &IMMDeviceEnumerator) -> Option<String> {
    // SAFETY: The enumerator is valid. A missing default endpoint is an ordinary empty outcome.
    unsafe {
        enumerator
            .GetDefaultAudioEndpoint(eCapture, eConsole)
            .ok()
            .and_then(|device| device_id(&device).ok())
    }
}

fn device_id(device: &IMMDevice) -> windows::core::Result<String> {
    // SAFETY: GetId returns a null-terminated COM-allocated string for this valid endpoint.
    let value = unsafe { device.GetId()? };
    owned_pwstr_to_string(value)
}

fn device_display_name(device: &IMMDevice) -> windows::core::Result<String> {
    // SAFETY: The endpoint is valid and the property store is opened read-only.
    let store = unsafe { device.OpenPropertyStore(STGM_READ)? };
    // SAFETY: PKEY_Device_FriendlyName is a valid key. The PROPVARIANT is cleared below.
    let mut value = unsafe { store.GetValue(&PKEY_Device_FriendlyName)? };
    let result = propvariant_to_string(&value);
    // SAFETY: value was initialized by IPropertyStore::GetValue and is cleared exactly once.
    let clear_result = unsafe { PropVariantClear(&mut value) };
    match (result, clear_result) {
        (Ok(text), Ok(())) => Ok(text),
        (Err(error), _) | (Ok(_), Err(error)) => Err(error),
    }
}

fn propvariant_to_string(value: &PROPVARIANT) -> windows::core::Result<String> {
    // SAFETY: The input is an initialized PROPVARIANT and the returned string is COM-allocated.
    let text = unsafe { PropVariantToStringAlloc(value)? };
    owned_pwstr_to_string(text)
}

fn owned_pwstr_to_string(value: PWSTR) -> windows::core::Result<String> {
    // SAFETY: value is a valid null-terminated COM-allocated string from a Windows API above.
    let result = unsafe { value.to_string() }.map_err(|error| {
        windows::core::Error::new(HRESULT(0x80070057u32 as i32), error.to_string())
    });
    // SAFETY: The string was allocated by COM and is freed exactly once after copying.
    unsafe { CoTaskMemFree(Some(value.as_ptr().cast::<c_void>())) };
    result
}

struct ComApartment {
    should_uninitialize: bool,
}

impl ComApartment {
    fn initialize() -> Result<Self, DiscoveryError> {
        // SAFETY: Initializes COM for the current command thread without sharing raw pointers.
        let result = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
        if result == RPC_E_CHANGED_MODE {
            return Ok(Self {
                should_uninitialize: false,
            });
        }
        result.ok().map_err(|error| {
            DiscoveryError::platform("Could not initialize Windows audio discovery.", error)
        })?;
        Ok(Self {
            should_uninitialize: true,
        })
    }
}

impl Drop for ComApartment {
    fn drop(&mut self) {
        if self.should_uninitialize {
            // SAFETY: Balances the successful CoInitializeEx call on this same thread.
            unsafe { CoUninitialize() };
        }
    }
}
