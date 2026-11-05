#!/bin/bash

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")

echo "Starting CALL export..."

npm run prod

mv ro-crate-metadata.xlsx \
   ro-crate-metadata_${TIMESTAMP}.xlsx

echo "Export complete."
echo "Output: ro-crate-metadata_${TIMESTAMP}.xlsx"
