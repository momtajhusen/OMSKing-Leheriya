# ============================================================
# OMSKing — Makefile
# Ek hi jagah se sab kuch chalao.
# Usage: make <target>
# ============================================================

.PHONY: help install install-ci mongo-start mongo-stop mongo-status \
	run dev all backend admin build stop clean status test

SHELL := /bin/bash

# Default target — show help
.DEFAULT_GOAL := help

# ============================================================
# Help
# ============================================================
help: ## Show this help screen
	@echo ""
	@echo "╔══════════════════════════════════════════════════╗"
	@echo "║           OMSKing — Makefile Commands             ║"
	@echo "╚══════════════════════════════════════════════════╝"
	@echo ""
	@echo "━━━━━━━━━━━━ Setup ━━━━━━━━━━━━"
	@awk 'BEGIN {FS = ":.*## "}; /^[a-zA-Z_-]+:.*## / {printf "  make %-18s %s\n", $$1, $$2}' $(MAKEFILE_LIST) | grep -E 'install|mongo' 
	@echo ""
	@echo "━━━━━━━━━━━━ Run (Day-to-day) ━━━━━━━━━━━━"
	@awk 'BEGIN {FS = ":.*## "}; /^[a-zA-Z_-]+:.*## / {printf "  make %-18s %s\n", $$1, $$2}' $(MAKEFILE_LIST) | grep -E 'run |dev |all |backend |admin '
	@echo ""
	@echo "━━━━━━━━━━━━ Build / Clean ━━━━━━━━━━━━"
	@awk 'BEGIN {FS = ":.*## "}; /^[a-zA-Z_-]+:.*## / {printf "  make %-18s %s\n", $$1, $$2}' $(MAKEFILE_LIST) | grep -E 'build|stop|clean|status|test'
	@echo ""

# ============================================================
# Setup
# ============================================================
install: ## 1. Fresh install — pnpm deps + mongo autostart
	@echo "▶ pnpm install..."
	@pnpm install
	@echo "▶ Ensuring MongoDB is running (brew service)..."
	@-brew services start mongodb-community 2>/dev/null || \
	 (echo "  brew service failed — trying manual fork"; \
	  mongod --config /opt/homebrew/etc/mongod.conf --fork 2>/dev/null || true)
	@sleep 2
	@$(MAKE) --no-print-directory mongo-status
	@echo ""
	@echo "✅ Install done. Ab 'make run' se sab chalao."

install-ci: ## CI install (no local services)
	@pnpm install --frozen-lockfile

# ============================================================
# MongoDB
# ============================================================
mongo-start: ## Start MongoDB (via brew services, auto-restart on login)
	@brew services start mongodb-community 2>/dev/null || \
	 (mongod --config /opt/homebrew/etc/mongod.conf --fork && echo "Started via --fork")
	@sleep 2
	@$(MAKE) --no-print-directory mongo-status

mongo-stop: ## Stop MongoDB
	@-brew services stop mongodb-community 2>/dev/null
	@-pkill -f "mongod" 2>/dev/null || true
	@echo "MongoDB stopped."

mongo-status: ## Check MongoDB connectivity
	@if nc -z localhost 27017 2>/dev/null; then \
	  echo "✅ MongoDB: running on tcp://localhost:27017"; \
	else \
	  echo "❌ MongoDB: NOT RUNNING on :27017. Start with 'make mongo-start'"; \
	fi

# ============================================================
# Run (primary targets you'll use every day)
# ============================================================
run: dev ## ⭐ Default — start everything together (mongo-check + backend + admin)
dev: all ## Alias for 'make all'
all: mongo-status ## Start backend + admin together (concurrently, color-coded). Ctrl+C to stop all.
	@echo ""
	@echo "╔═══════════════════════════════════════════════════╗"
	@echo "║  OMSKing — Starting all services                  ║"
	@echo "║  Backend  → http://localhost:5001  (magenta)      ║"
	@echo "║  Admin UI → http://localhost:5173  (cyan)         ║"
	@echo "║  MongoDB  → tcp://localhost:27017  (gray)         ║"
	@echo "║                                                   ║"
	@echo "║  Press Ctrl+C ONCE to stop EVERYTHING cleanly     ║"
	@echo "╚═══════════════════════════════════════════════════╝"
	@echo ""
	@pnpm run dev:all

backend: mongo-status ## Only run backend (port 5001)
	@pnpm run dev:backend

admin: mongo-status ## Only run admin (port 5173) — auto waits for backend
	@pnpm run start:admin

# ============================================================
# Build / Test / Clean
# ============================================================
build: ## Production build admin + backend check
	@pnpm run build

stop: ## Kill backend (5001) + admin (5173) dev servers
	@-lsof -ti:5001,5173 | xargs kill -9 2>/dev/null || true
	@echo "✅ Stopped processes on ports 5001 and 5173."

clean: ## Remove node_modules + dist + build artifacts
	@pnpm run clean
	@echo "✅ Cleaned build artifacts and node_modules."

status: ## Quick status — mongo, ports
	@$(MAKE) --no-print-directory mongo-status
	@if nc -z localhost 5001 2>/dev/null; then echo "✅ Backend : running on http://localhost:5001"; else echo "◻️  Backend : not running on :5001"; fi
	@if nc -z localhost 5173 2>/dev/null; then echo "✅ Admin   : running on http://localhost:5173"; else echo "◻️  Admin   : not running on :5173"; fi

test: build ## Placeholder test: just ensures build passes
	@echo "✅ Build OK — real tests added Phase 2+."
