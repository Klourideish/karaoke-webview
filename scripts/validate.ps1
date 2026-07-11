$ErrorActionPreference = "Stop"

function Invoke-Step {
    param(
        [Parameter(Mandatory = $true)]
        [string] $Name,

        [Parameter(Mandatory = $true)]
        [scriptblock] $Command
    )

    Write-Host ""
    Write-Host "==> $Name"
    & $Command
    if ($LASTEXITCODE -ne 0) {
        $exitCode = $LASTEXITCODE
        Write-Error "$Name failed with exit code $exitCode"
        exit $exitCode
    }
}

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$cargoCommand = Get-Command cargo -ErrorAction SilentlyContinue
$cargoPath = $cargoCommand.Source
if (-not $cargoCommand) {
    $fallbackCargoPath = Join-Path $env:USERPROFILE ".cargo\bin\cargo.exe"
    if (Test-Path -LiteralPath $fallbackCargoPath) {
        $cargoPath = $fallbackCargoPath
    }
}

if (-not $cargoPath) {
    Write-Error "Cargo was not found. Install the Rust stable MSVC toolchain and restart the shell."
    exit 127
}

Invoke-Step "Checking npm dependency integrity" { npm ci --ignore-scripts }
Invoke-Step "Checking formatting" { npm run format:check }
Invoke-Step "Running ESLint" { npm run lint }
Invoke-Step "Running TypeScript checks" { npm run typecheck }
Invoke-Step "Running frontend tests" { npm run test }
Invoke-Step "Building frontend" { npm run build }
Invoke-Step "Checking Rust formatting" {
    & $cargoPath fmt --manifest-path src-tauri/Cargo.toml --check
}
Invoke-Step "Checking Rust project" { & $cargoPath check --manifest-path src-tauri/Cargo.toml }
Invoke-Step "Running Rust tests" { & $cargoPath test --manifest-path src-tauri/Cargo.toml }

Write-Host ""
Write-Host "Validation completed successfully."
