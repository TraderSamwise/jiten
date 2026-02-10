#!/bin/bash

# Build Script - Creates native builds
# Usage:
#   yarn build:testflight   # Build for TestFlight (default)
#   yarn build:production   # Build for App Store

set -e

CHANNEL="testflight"

for arg in "$@"; do
  case $arg in
    --production)
      CHANNEL="production"
      shift
      ;;
    --testflight)
      CHANNEL="testflight"
      shift
      ;;
  esac
done

if [ "$CHANNEL" = "production" ]; then
  EAS_PROFILE="production"
  CHANNEL_NAME="Production (App Store)"
else
  EAS_PROFILE="testflight"
  CHANNEL_NAME="TestFlight"
fi

echo "🚀 Starting $CHANNEL_NAME build for iOS..."

echo ""
./scripts/version-manager.sh current
echo ""

echo "🏗️  Starting EAS build ($CHANNEL_NAME)..."
eas build --platform ios --profile "$EAS_PROFILE" --auto-submit

echo ""
echo "✅ Build process complete!"
echo ""
./scripts/version-manager.sh current
echo ""
echo "Monitor progress at: https://expo.dev/accounts/tradersamwise/projects/jiten/builds"
echo ""
echo "🎉 Build initiated successfully!"
