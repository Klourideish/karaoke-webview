use std::{collections::BTreeMap, net::Ipv4Addr};

use super::models::{
    PhonePairingAddressCandidate, PhonePairingListenerError, PhonePairingListenerErrorCode,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct InterfaceAddress {
    pub name: String,
    pub index: Option<u32>,
    pub address: Ipv4Addr,
    pub is_up: bool,
}

pub(super) fn discover_phone_pairing_candidates(
) -> Result<Vec<PhonePairingAddressCandidate>, PhonePairingListenerError> {
    let interfaces = if_addrs::get_if_addrs().map_err(|error| {
        PhonePairingListenerError::new(
            PhonePairingListenerErrorCode::EndpointResolutionFailed,
            format!("Could not inspect Host network interfaces: {error}"),
        )
    })?;

    Ok(phone_pairing_candidates(
        interfaces
            .into_iter()
            .filter_map(|interface| match interface.ip() {
                std::net::IpAddr::V4(address) => {
                    let is_up = interface.is_oper_up();
                    Some(InterfaceAddress {
                        name: interface.name,
                        index: interface.index,
                        address,
                        is_up,
                    })
                }
                std::net::IpAddr::V6(_) => None,
            })
            .collect(),
    ))
}

pub(super) fn phone_pairing_candidates(
    interfaces: Vec<InterfaceAddress>,
) -> Vec<PhonePairingAddressCandidate> {
    let mut candidates = interfaces
        .into_iter()
        .filter(is_usable_interface)
        .collect::<Vec<_>>();

    if candidates
        .iter()
        .any(|candidate| candidate.address.is_private())
    {
        candidates.retain(|candidate| candidate.address.is_private());
    }

    let mut unique = BTreeMap::new();
    for candidate in candidates {
        unique
            .entry(candidate.address)
            .and_modify(|current: &mut InterfaceAddress| {
                if interface_order_key(&candidate) < interface_order_key(current) {
                    *current = candidate.clone();
                }
            })
            .or_insert(candidate);
    }

    unique
        .into_values()
        .map(|candidate| PhonePairingAddressCandidate {
            id: format!(
                "interface-{}-{}",
                candidate.index.unwrap_or_default(),
                candidate.address
            ),
            address: candidate.address.to_string(),
            interface_name: candidate.name,
        })
        .collect()
}

pub(super) fn is_phone_reachable_ipv4(value: &str) -> bool {
    value
        .parse::<Ipv4Addr>()
        .is_ok_and(|address| is_usable_address(address))
}

fn is_usable_interface(interface: &InterfaceAddress) -> bool {
    interface.is_up
        && is_usable_address(interface.address)
        && !is_clearly_virtual_only(&interface.name)
}

fn is_usable_address(address: Ipv4Addr) -> bool {
    !address.is_loopback()
        && !address.is_unspecified()
        && !address.is_multicast()
        && !address.is_link_local()
        && address != Ipv4Addr::BROADCAST
}

fn is_clearly_virtual_only(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    [
        "loopback",
        "vethernet",
        "virtualbox",
        "vmware",
        "hyper-v",
        "wsl",
        "docker",
        "bluetooth network",
        "teredo",
    ]
    .iter()
    .any(|marker| name.contains(marker))
}

fn interface_order_key(interface: &InterfaceAddress) -> (u32, &str) {
    (interface.index.unwrap_or(u32::MAX), interface.name.as_str())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn interface(name: &str, index: u32, address: [u8; 4]) -> InterfaceAddress {
        InterfaceAddress {
            name: name.to_string(),
            index: Some(index),
            address: Ipv4Addr::from(address),
            is_up: true,
        }
    }

    #[test]
    fn loopback_and_link_local_addresses_are_excluded() {
        let candidates = phone_pairing_candidates(vec![
            interface("Loopback", 1, [127, 0, 0, 1]),
            interface("Ethernet", 2, [169, 254, 10, 4]),
            interface("Wi-Fi", 3, [192, 168, 1, 20]),
        ]);

        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].address, "192.168.1.20");
    }

    #[test]
    fn private_ipv4_candidates_are_preferred_and_sorted_deterministically() {
        let candidates = phone_pairing_candidates(vec![
            interface("Public", 5, [203, 0, 113, 10]),
            interface("Wi-Fi", 4, [192, 168, 1, 30]),
            interface("Ethernet", 2, [10, 0, 0, 8]),
        ]);

        assert_eq!(
            candidates
                .iter()
                .map(|candidate| candidate.address.as_str())
                .collect::<Vec<_>>(),
            vec!["10.0.0.8", "192.168.1.30"]
        );
    }

    #[test]
    fn down_and_clearly_virtual_interfaces_are_excluded() {
        let mut down = interface("Ethernet", 1, [192, 168, 1, 2]);
        down.is_up = false;
        let candidates = phone_pairing_candidates(vec![
            down,
            interface("vEthernet (Default Switch)", 2, [172, 20, 0, 1]),
            interface("Wi-Fi", 3, [192, 168, 1, 3]),
        ]);

        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].interface_name, "Wi-Fi");
    }
}
