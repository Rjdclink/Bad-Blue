.PHONY: help setup start stop restart logs clean shell db-shell status

.DEFAULT_GOAL := help

help:
	@echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
	@echo "  PANTHEON Development Commands"
	@echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
	@echo "  make setup       - Initial setup (90 sec)"
	@echo "  make start       - Start all services"
	@echo "  make stop        - Stop all services"
	@echo "  make restart     - Restart all services"
	@echo "  make logs        - View logs"
	@echo "  make shell       - Open app shell"
	@echo "  make db-shell    - Open database shell"
	@echo "  make status      - Show service status"
	@echo "  make clean       - Remove all containers"
	@echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

setup:
	@bash scripts/instant-setup.sh

start:
	@docker-compose up -d
	@echo "✅ Services started at http://localhost:5000"

stop:
	@docker-compose down
	@echo "✅ Services stopped"

restart:
	@docker-compose restart
	@echo "✅ Services restarted"

logs:
	@docker-compose logs -f

shell:
	@docker-compose exec app sh

db-shell:
	@docker-compose exec db psql -U postgres -d legalwhat

status:
	@docker-compose ps

clean:
	@docker-compose down -v
	@echo "✅ Cleaned up"
