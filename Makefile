SHELL := /bin/bash

# `make publish patch` passes the bump as an extra goal; see the no-op targets below.
BUMP := $(filter major minor patch,$(MAKECMDGOALS))

.DEFAULT_GOAL := help
.PHONY: help install build build-cli watch lint test test-cli test-all check \
	package pack-cli clean publish publish-vscode major minor patch

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*## ' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*## "} {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

install: ## Install dependencies (npm ci)
	npm ci

build: ## Build the extension and CLI bundles
	npm run compile

build-cli: ## Build only the CLI bundle (packages/cli/dist/cli.js)
	npm run build:cli

watch: ## Rebuild bundles on change
	npm run watch

lint: ## Run ESLint
	npm run lint

test: ## Run the VS Code extension tests (Electron)
	npm test

test-cli: ## Run the core and CLI tests (Vitest)
	npm run test:cli

test-all: lint test-cli test ## Run lint and every test suite

check: build-cli ## Run the CLI, e.g. make check ARGS="path/to/course"
	npm run check -- $(ARGS)

package: ## Build the .vsix
	npx vsce package

pack-cli: ## Show what the npm package would contain
	cd packages/cli && npm pack --dry-run

clean: ## Remove build output
	rm -rf out dist packages/cli/dist packages/cli/LICENSE

publish: ## Release both packages: make publish patch|minor|major [DRY_RUN=1]
	@if [ "$(words $(BUMP))" != 1 ]; then \
		echo "usage: make publish patch|minor|major [DRY_RUN=1]" >&2; exit 2; \
	fi
	scripts/release.sh $(BUMP)

publish-vscode: ## Resume Marketplace publishing after npm approval or workflow recovery
	scripts/release.sh --resume-vscode

# Bump words for `make publish <bump>`; they do nothing on their own.
major minor patch:
	@:
