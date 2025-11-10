#!/bin/bash
# Virtual environment creation script for AI Avatar Assistant

set -e  # Exit on error

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}🤖 AI Avatar Assistant - Virtual Environment Setup${NC}"
echo ""

# Get the project directory (parent of scripts directory)
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="$PROJECT_DIR/venv"

echo -e "${YELLOW}📁 Project directory: $PROJECT_DIR${NC}"
echo ""

# Check if Python 3 is installed
if ! command -v python3 &> /dev/null; then
    echo -e "${RED}❌ Python 3 is not installed. Please install Python 3.8 or higher.${NC}"
    exit 1
fi

# Display Python version
PYTHON_VERSION=$(python3 --version)
echo -e "${GREEN}✅ Found: $PYTHON_VERSION${NC}"

# Remove existing venv if it exists
if [ -d "$VENV_DIR" ]; then
    echo -e "${YELLOW}⚠️  Existing virtual environment found. Removing...${NC}"
    rm -rf "$VENV_DIR"
fi

# Create virtual environment
echo -e "${GREEN}📦 Creating virtual environment...${NC}"
python3 -m venv "$VENV_DIR"

# Activate virtual environment
echo -e "${GREEN}🔌 Activating virtual environment...${NC}"
source "$VENV_DIR/bin/activate"

# Upgrade pip
echo -e "${GREEN}⬆️  Upgrading pip...${NC}"
pip install --upgrade pip

# Install wheel for better package installation
echo -e "${GREEN}📦 Installing wheel...${NC}"
pip install wheel

# Install requirements
if [ -f "$PROJECT_DIR/requirements.txt" ]; then
    echo -e "${GREEN}📥 Installing Python dependencies...${NC}"
    echo -e "${YELLOW}⏳ This may take several minutes (downloading PyTorch CPU version)...${NC}"
    
    # Install PyTorch CPU version separately with proper index URL
    pip install torch==2.1.0 --index-url https://download.pytorch.org/whl/cpu
    
    # Install other requirements (skip torch line)
    grep -v "^torch==" "$PROJECT_DIR/requirements.txt" | grep -v "^#" | grep -v "^--" | pip install -r /dev/stdin
else
    echo -e "${RED}❌ requirements.txt not found!${NC}"
    exit 1
fi

# Create necessary directories
echo -e "${GREEN}📁 Creating necessary directories...${NC}"
mkdir -p "$PROJECT_DIR/models"
mkdir -p "$PROJECT_DIR/audio"
mkdir -p "$PROJECT_DIR/logs"

echo ""
echo -e "${GREEN}✅ Virtual environment setup complete!${NC}"
echo ""
echo -e "${YELLOW}📌 To activate the virtual environment manually:${NC}"
echo -e "   ${GREEN}source $VENV_DIR/bin/activate${NC}"
echo ""
echo -e "${YELLOW}📌 To deactivate:${NC}"
echo -e "   ${GREEN}deactivate${NC}"
echo ""
echo -e "${YELLOW}📌 To start the server:${NC}"
echo -e "   ${GREEN}source $VENV_DIR/bin/activate${NC}"
echo -e "   ${GREEN}python backend/server.py${NC}"
echo ""
echo -e "${GREEN}🎉 All done!${NC}"
