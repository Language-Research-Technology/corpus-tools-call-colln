# corpus-tools-call-colln

A small Node.js script that exports data from a CALL PostgreSQL database into an Excel workbook. The workbook is structured as multiple sheets containing metadata extracted from the CALL database, making it easier to review and reuse corpus data in spreadsheet tools.

## What this project does

The script connects to a PostgreSQL database, queries CALL database tables, reshapes the results into spreadsheet-friendly rows, and writes a workbook named `ro-crate-metadata.xlsx`.

The workbook currently generates the following sheets:

- **Objects** – corpus item records and associated metadata, including languages, keywords, subjects, sponsors, and places.
- **People** – contributors and their recorded name variants.
- **ObjectPersonRole** – relationships between corpus objects, contributors, and their roles.
- **Languages** – language records and associated language names.
- **Licenses** – license metadata used within the corpus.

## Requirements

- Node.js
- npm
- Access to a PostgreSQL database containing the CALL schema

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
npm run dev
```
or

Run against the production database:

```bash
npm run prod
```

## Output

The script generates an Excel workbook named:

```text
ro-crate-metadata.xlsx
```
