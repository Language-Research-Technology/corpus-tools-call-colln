#!/bin/bash

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")

echo "Starting CALL export..."

npm run prod

echo "Export complete."
echo "Output: ro-crate-metadata.xlsx"
