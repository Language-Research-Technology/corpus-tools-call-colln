# corpus-tools-call-colln

A Node.js script that exports a CALL PostgreSQL database and its local files into an RO-Crate in an OCFL repository, and generates an Excel workbook from the crate.

## What this project does

Each item record becomes a repository object, linked to its contributors, languages, places, licences, and files. The script writes the corpus to an OCFL repository and generates `ro-crate-metadata.xlsx` from its metadata.

## Requirements

- Node.js
- npm
- Access to a PostgreSQL database containing the CALL schema
- A template RO-Crate and the local item and cover image files

## Install

Install dependencies:

```bash
npm install
```

## Configuration

Create `.env` files containing the PostgreSQL connection string for each environment (eg: local, prod).

Examples:

```bash
# Local development
echo CALL_PG_URL="postgres://postgres:postgres@localhost:5432/postgres" > .env.dev

# Production
echo CALL_PG_URL="postgres://<username>:<password>@example.com:5432/dbname" > .env.prod
```

The default OCFL storage root is `ocfl-repo` in this project directory. Collector creates it when it does not exist. Override it with `CALL_OCFL_REPO_PATH` in the environment or `--repo-path` on the command line; the command-line option takes precedence. The chosen absolute path is printed on startup. An existing root must already be a valid OCFL repository: choose a new, nonexistent path or initialize the directory as an OCFL repository if you see `Invalid storage root`. The exporter does not delete or overwrite an invalid directory.

By default, the exporter searches `files/item_record_files` and `files/cover_images` relative to the working directory. Set `CALL_ITEM_RECORD_FILES_DIR` and `CALL_COVER_IMAGE_DIR` to use other paths. Each directory is searched recursively: `item_record_file_file_name` matches an item file and `cover_image_file_name` matches a cover image. Matching is exact and case-sensitive. Cover matches are included only when they are inside a directory named `original`, and each is linked to its item through both `hasPart` and `image`. All eligible matches are included, even when a name appears in multiple subdirectories. Missing matches are logged as errors and omitted; the export continues and is reported as incomplete. An unreadable source directory or another fatal error still stops the export. Symbolic links are not followed. Unreferenced files are not imported.

Each run writes a separate timestamped log in `logs` in the working directory; set `CALL_LOG_DIR` to choose another directory. The log path is printed at startup. It contains item progress, warnings, missing-file errors, and fatal errors. A completed export with missing files exits successfully but is incomplete; check the log before using it. The log can contain item IDs, filenames, and local paths, so store it appropriately.

For production, use the credentials from the application's Heroku Postgres database:

```text
Heroku Dashboard
└── Personal
    └── Datastores
        └── postgresql-regular-XXXXX (for your app)
            └── Credentials
                └── Database Credentials
```


## Usage

Run against the development database:

```bash
npm run dev -- --template /path/to/template --namespace COLLECTION_ID
```
or

Run against the production database:

```bash
npm run prod -- --template /path/to/template --namespace COLLECTION_ID
```

## Output

The script writes the corpus RO-Crate and referenced files to the configured OCFL repository and generates an Excel workbook in the working directory named:

```text
ro-crate-metadata.xlsx
```
