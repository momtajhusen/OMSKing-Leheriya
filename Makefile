# ============================================================
# OMSKing — Makefile
# Ek hi jagah se sab kuch chalao.
# Usage: make <target>
# ============================================================

.PHONY: help install install-ci mongo-start mongo-stop mongo-status ensure-mongo \
	run dev all backend admin build stop clean status test seed

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

ensure-mongo: ## Auto-start MongoDB if not running
	@if nc -z localhost 27017 2>/dev/null; then \
	  echo "✅ MongoDB already running on tcp://localhost:27017"; \
	else \
	  echo "🚀 Starting MongoDB..."; \
	  brew services start mongodb-community@7.0 2>/dev/null || \
	  brew services start mongodb-community 2>/dev/null || \
	   (mongod --config /opt/homebrew/etc/mongod.conf --fork && echo "Started via --fork"); \
	  echo "⏳ Waiting for MongoDB to be ready..."; \
	  for i in $$(seq 1 30); do \
	    if nc -z localhost 27017 2>/dev/null; then \
	      echo "✅ MongoDB is now ready on tcp://localhost:27017"; \
	      exit 0; \
	    fi; \
	    sleep 1; \
	  done; \
	  echo "❌ MongoDB failed to start within 30 seconds"; \
	  echo "   If disk is full, free space then retry. Data files are Mongo 7.0."; \
	  exit 1; \
	fi

# ============================================================
# Run (primary targets you'll use every day)
# ============================================================
run: dev ## ⭐ Default — start everything together (mongo-check + backend + admin)
dev: all ## Alias for 'make all'
all: ensure-mongo ## Start backend + admin together (concurrently, color-coded). Ctrl+C to stop all.
	@echo ""
	@echo "╔═══════════════════════════════════════════════════╗"
	@echo "║  OMSKing — Starting all services                  ║"
	@echo "║  Backend     → http://localhost:5002  (magenta)    ║"
	@echo "║  App         → http://localhost:5173  (cyan)      ║"
	@echo "║    Public    → /  /about  /features  /pricing     ║"
	@echo "║    Login     → /auth/login                         ║"
	@echo "║    Platform  → /platform   (SaaS control)          ║"
	@echo "║    Merchant  → /dashboard  Vendor → /vendor/orders ║"
	@echo "║  MongoDB     → tcp://localhost:27017  (gray)       ║"
	@echo "║                                                   ║"
	@echo "║  Press Ctrl+C ONCE to stop EVERYTHING cleanly     ║"
	@echo "╚═══════════════════════════════════════════════════╝"
	@echo ""
	@pnpm run dev:all

backend: ensure-mongo ## Only run backend (port 5002)
	@pnpm run dev:backend

admin: ensure-mongo ## Only run frontend (port 5173) — public + admin, waits for backend
	@pnpm run start:admin

# ============================================================
# Build / Test / Clean
# ============================================================
build: ## Production build admin + backend check
	@pnpm run build

stop: ## Kill backend (5002) + frontend (5173) dev servers
	@-lsof -ti:5002,5173 | xargs kill -9 2>/dev/null || true
	@echo "✅ Stopped processes on ports 5002 and 5173."

clean: ## Remove node_modules + dist + build artifacts
	@pnpm run clean
	@echo "✅ Cleaned build artifacts and node_modules."

status: ## Quick status — mongo, ports
	@$(MAKE) --no-print-directory mongo-status
	@if nc -z localhost 5002 2>/dev/null; then echo "✅ Backend : running on http://localhost:5002"; else echo "◻️  Backend : not running on :5002"; fi
	@if nc -z localhost 5173 2>/dev/null; then echo "✅ App     : running on http://localhost:5173"; else echo "◻️  App     : not running on :5173"; fi

test: build ## Placeholder test: just ensures build passes
	@echo "✅ Build OK — real tests added Phase 2+."

seed: ensure-mongo ## Seed Phase 2 auth users/tenants/roles
	@pnpm --filter @omsking/backend run seed
