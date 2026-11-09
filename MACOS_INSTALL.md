# Operator Desktop for macOS

Download and install the latest build with Terminal. Choose the command for your Mac.

## Apple Silicon

```bash
curl -fL https://github.com/yrn-dev/operator-desk/releases/latest/download/Operator-mac-arm64.zip -o /tmp/Operator-mac-arm64.zip && mkdir -p "$HOME/Applications" && ditto -xk /tmp/Operator-mac-arm64.zip "$HOME/Applications"
```

## Intel

```bash
curl -fL https://github.com/yrn-dev/operator-desk/releases/latest/download/Operator-mac-x64.zip -o /tmp/Operator-mac-x64.zip && mkdir -p "$HOME/Applications" && ditto -xk /tmp/Operator-mac-x64.zip "$HOME/Applications"
```

The builds are not signed or notarized with an Apple Developer certificate. If macOS blocks the app, Control-click `Operator.app` in Applications and choose **Open** once. If Gatekeeper still blocks it and you trust this release, run:

```bash
xattr -dr com.apple.quarantine "$HOME/Applications/Operator.app"
```

On first launch, allow Screen Recording and Accessibility only if you want the desktop agent to inspect and control other windows.
