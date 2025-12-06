#!/bin/bash
set -e

echo "🚀 PANTHEON Instant Setup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

command_exists() {
    command -v "$1" &> /dev/null
}

OS="unknown"
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    OS="linux"
elif [[ "$OSTYPE" == "darwin"* ]]; then
    OS="mac"
fi

echo "📋 Detected OS: $OS"

if ! command_exists docker; then
    echo "❌ Docker not found. Please install Docker Desktop first."
    echo "   Download from: https://www.docker.com/products/docker-desktop"
    exit 1
fi

echo "✅ Docker found"

if ! command_exists docker-compose && ! docker compose version &> /dev/null; then
    echo "❌ Docker Compose not found"
    exit 1
fi

echo "✅ Docker Compose found"

if [ ! -f ".env" ]; then
    echo ""
    echo "🔐 Generating .env configuration..."
    cp .env.example .env
    
    if command_exists openssl; then
        SESSION_SECRET=$(openssl rand -hex 32)
        
        if [[ "$OS" == "mac" ]]; then
            sed -i '' "s/generate-a-long-random-string-here/$SESSION_SECRET/" .env
        else
            sed -i "s/generate-a-long-random-string-here/$SESSION_SECRET/" .env
        fi
        
        echo "✅ Secure secrets generated"
    fi
else
    echo "✅ Existing .env found"
fi

echo ""
echo "🐳 Starting services..."

if docker compose version &> /dev/null; then
    COMPOSE_CMD="docker compose"
else
    COMPOSE_CMD="docker-compose"
fi

$COMPOSE_CMD up -d

echo ""
echo "⏳ Waiting for services..."
sleep 10

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ PANTHEON IS READY"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "🌐 Application:  http://localhost:5000"
echo "📊 Database:     postgresql://postgres:postgres@localhost:5432/legalwhat"
echo ""
echo "📝 View logs:    $COMPOSE_CMD logs -f"
echo "🛑 Stop:         $COMPOSE_CMD down"
echo ""
