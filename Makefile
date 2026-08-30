# mitanshu.dev — a static site, so these are conveniences, not a build.
.PHONY: help serve check facts clean

PORT ?= 4173

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
	  awk 'BEGIN{FS=":.*?## "}{printf "  %-10s %s\n", $$1, $$2}'

serve: ## Serve locally at http://localhost:$(PORT)
	@PORT=$(PORT) scripts/serve.sh

check: ## Quick sanity: every local href/src resolves on disk
	@echo "Checking local asset references..."
	@grep -rhoE '(src|srcset|href|poster)="/[^"]+"' index.html projects/*.html 404.html \
	  | sed -E 's/.*="(\/[^"]+)"/\1/' | grep -v '^/#' | sort -u | while read -r p; do \
	    f=".$$p"; [ -f "$$f" ] || echo "  MISSING: $$p"; \
	  done; echo "done."
	@scripts/check-facts.sh

facts: ## Verify no corrected figure has crept back in
	@scripts/check-facts.sh

clean: ## Remove local scratch/verification artifacts
	@rm -f check-*.jpeg check-*.png hero-live-*.png *-desktop.png *-mobile.png "Pasted image.png"
	@echo "cleaned scratch files."
