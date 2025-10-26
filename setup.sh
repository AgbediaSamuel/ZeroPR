#!/bin/bash

# ZeroPR Setup Script
set -e

echo "Setting up ZeroPR development environment..."
echo ""

# Check prerequisites
echo "Checking prerequisites..."

if ! command -v node &> /dev/null; then
    echo "[ERROR] Node.js is not installed. Please install Node.js 18+ first."
    exit 1
fi

if ! command -v go &> /dev/null; then
    echo "[ERROR] Go is not installed. Please install Go 1.21+ first."
    exit 1
fi

echo "[OK] Node.js $(node --version)"
echo "[OK] Go $(go version)"
echo ""

# Install npm dependencies
echo "Installing npm dependencies..."
npm install
echo ""

# Build shared types
echo "Building shared types..."
cd shared
npm run build
cd ..
echo ""

# Install extension dependencies
echo "Installing extension dependencies..."
cd extension
npm install
cd ..
echo ""

# Download Go dependencies
echo "Downloading Go dependencies..."
cd agent
go mod download
cd ..
echo ""

# Build agent
echo "Building Go agent..."
cd agent
go build -o bin/zeropr-agent ./cmd/agent
cd ..
echo ""

echo "[DONE] Setup complete!"
echo ""
echo "Next steps:"
echo "  1. Start the agent: cd agent && ./bin/zeropr-agent"
echo "  2. Open extension in VS Code: cd extension && code ."
echo "  3. Press F5 to launch the extension development host"
echo ""
echo "Or run both together:"
echo "  Terminal 1: npm run dev:agent"
echo "  Terminal 2: cd extension && npm run watch"
echo "  Then press F5 in VS Code (extension folder)"

