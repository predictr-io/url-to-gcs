# URL to GCS GitHub Action

A GitHub Action that fetches content from any URL and uploads it directly to Google Cloud Storage. Perfect for archiving web content, downloading and storing artifacts, or integrating external data into your GCS-backed workflows.

## Features

- **Streaming architecture** - Handles files of any size without disk storage
- **HTTP methods** - GET, POST, PUT, PATCH, DELETE
- **Authentication** - Basic auth and Bearer token support
- **Retry logic** - Automatic retry on transient failures with exponential backoff
- **Timeout control** - Configurable timeouts (default: 15 minutes)
- **Custom headers** - Full control over HTTP headers
- **GCS features** - Storage class, ACL, metadata, cache control
- **Real byte counting** - Tracks actual bytes transferred (not just headers)
- **Progress tracking** - Upload progress logging
- **Cross-platform** - Linux, macOS, Windows runners

## Prerequisites

You must configure GCP credentials before using this action. We recommend using `google-github-actions/auth@v2`:

### Workload Identity Federation (Recommended)

```yaml
- name: Authenticate to Google Cloud
  uses: google-github-actions/auth@v2
  with:
    workload_identity_provider: 'projects/123456789/locations/global/workloadIdentityPools/my-pool/providers/my-provider'
    service_account: 'my-service-account@my-project.iam.gserviceaccount.com'
```

### Service Account Key

```yaml
- name: Authenticate to Google Cloud
  uses: google-github-actions/auth@v2
  with:
    credentials_json: '${{ secrets.GCP_CREDENTIALS }}'
```

## Usage

### Basic Example

Download a file and upload to GCS:

```yaml
- name: Download and upload to GCS
  uses: predictr-io/url-to-gcs@v1
  with:
    url: 'https://example.com/data.json'
    gcs-bucket: 'my-bucket'
    gcs-object: 'downloads/data.json'
```

### Complete Example

```yaml
name: Archive External Content

on:
  schedule:
    - cron: '0 0 * * *'  # Daily at midnight
  workflow_dispatch:

jobs:
  archive:
    runs-on: ubuntu-latest
    
    permissions:
      contents: 'read'
      id-token: 'write'

    steps:
      - name: Authenticate to Google Cloud
        uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: ${{ secrets.WIF_PROVIDER }}
          service_account: ${{ secrets.WIF_SERVICE_ACCOUNT }}

      - name: Download and upload to GCS
        id: upload
        uses: predictr-io/url-to-gcs@v1
        with:
          url: 'https://api.example.com/data'
          method: 'GET'
          gcs-bucket: 'my-archive-bucket'
          gcs-object: 'archives/${{ github.run_number }}/data.json'
          storage-class: 'NEARLINE'
          cache-control: 'max-age=86400'

      - name: Print results
        run: |
          echo "Status Code: ${{ steps.upload.outputs.status-code }}"
          echo "Content Length: ${{ steps.upload.outputs.content-length }}"
          echo "GCS URL: ${{ steps.upload.outputs.gcs-url }}"
          echo "Generation: ${{ steps.upload.outputs.generation }}"
```

### Authentication Examples

#### Basic Authentication

```yaml
- name: Download with Basic Auth
  uses: predictr-io/url-to-gcs@v1
  with:
    url: 'https://api.example.com/data'
    auth-type: 'basic'
    auth-username: ${{ secrets.API_USER }}
    auth-password: ${{ secrets.API_PASS }}
    gcs-bucket: 'my-bucket'
    gcs-object: 'data.json'
```

#### Bearer Token

```yaml
- name: Download with Bearer Token
  uses: predictr-io/url-to-gcs@v1
  with:
    url: 'https://api.example.com/data'
    auth-type: 'bearer'
    auth-token: ${{ secrets.API_TOKEN }}
    gcs-bucket: 'my-bucket'
    gcs-object: 'data.json'
```

### POST Request Example

```yaml
- name: POST to API and upload response
  uses: predictr-io/url-to-gcs@v1
  with:
    url: 'https://api.example.com/generate-report'
    method: 'POST'
    headers: 'Content-Type=application/json; Accept=application/json'
    post-data: '{"type": "daily", "format": "csv"}'
    gcs-bucket: 'reports-bucket'
    gcs-object: 'reports/daily-report.csv'
```

### Retry and Timeout

```yaml
- name: Download with retry logic
  uses: predictr-io/url-to-gcs@v1
  with:
    url: 'https://unreliable-api.com/data'
    enable-retry: true  # Retries up to 3 times with exponential backoff
    timeout: 300000     # 5 minutes timeout
    gcs-bucket: 'my-bucket'
    gcs-object: 'data.json'
```

### GCS Metadata and Storage Class

```yaml
- name: Upload with metadata and storage class
  uses: predictr-io/url-to-gcs@v1
  with:
    url: 'https://example.com/data.json'
    gcs-bucket: 'my-bucket'
    gcs-object: 'data.json'
    metadata: 'source=example.com; archived-by=github-actions'
    predefined-acl: 'private'
    storage-class: 'COLDLINE'
```

## Inputs

### Required Inputs

| Input | Description |
|-------|-------------|
| `url` | The URL to fetch content from |
| `gcs-bucket` | Target GCS bucket name |
| `gcs-object` | Target object name/path in GCS |

### Optional HTTP Inputs

| Input | Description | Default |
|-------|-------------|---------|
| `method` | HTTP method (GET, POST, PUT, etc.) | `GET` |
| `headers` | HTTP headers as JSON or semicolon-separated `key=value` pairs | - |
| `post-data` | POST/PUT request body data | - |
| `timeout` | Request timeout in milliseconds | `900000` (15 min) |
| `enable-retry` | Enable automatic retry on failures | `false` |

### Authentication Inputs

| Input | Description | Default |
|-------|-------------|---------|
| `auth-type` | Authentication type: `none`, `basic`, or `bearer` | `none` |
| `auth-username` | Username for basic authentication | - |
| `auth-password` | Password for basic authentication | - |
| `auth-token` | Token for bearer authentication | - |

### Optional GCS Inputs

| Input | Description | Default |
|-------|-------------|---------|
| `storage-class` | GCS storage class (`STANDARD`, `NEARLINE`, `COLDLINE`, `ARCHIVE`) | `STANDARD` |
| `predefined-acl` | Predefined ACL (see below) | - |
| `content-type` | Override Content-Type for GCS object | Auto-detected from HTTP response |
| `cache-control` | Cache-Control header for GCS object | - |
| `metadata` | Custom metadata as JSON or semicolon-separated `key=value` pairs | - |

## Outputs

| Output | Description |
|--------|-------------|
| `status-code` | HTTP status code from the URL request |
| `content-length` | Size of downloaded content in bytes |
| `gcs-url` | GCS URL of uploaded object (gs://bucket/object format) |
| `generation` | Generation number of the uploaded GCS object |

## Input Formats

Headers and metadata can be provided in two formats:

**JSON format:**
```yaml
headers: '{"Authorization": "Bearer token123", "User-Agent": "MyApp/1.0"}'
metadata: '{"source": "example.com", "version": "1.0"}'
```

**Semicolon-separated format:**
```yaml
headers: 'Authorization=Bearer token123; User-Agent=MyApp/1.0'
metadata: 'source=example.com; version=1.0'
```

**Note:** Spaces after semicolons are automatically trimmed.

## Storage Classes

Supported GCS storage classes:
- `STANDARD` (default) - Best for frequently accessed data
- `NEARLINE` - Low-cost storage for data accessed less than once a month
- `COLDLINE` - Very low-cost storage for data accessed less than once a quarter
- `ARCHIVE` - Lowest-cost storage for data accessed less than once a year

## Predefined ACL Options

Supported predefined ACLs:
- `authenticatedRead` - Authenticated users have read access
- `bucketOwnerFullControl` - Bucket owner has full control
- `bucketOwnerRead` - Bucket owner has read access
- `private` - Only owner has access (default if not specified)
- `projectPrivate` - Project team members have access based on roles
- `publicRead` - Public read access

## Required IAM Permissions

The service account or Workload Identity needs:

- `storage.objects.create` - To create objects
- `storage.objects.delete` - To overwrite existing objects
- `storage.buckets.get` - To verify bucket exists

**Predefined Role:** `roles/storage.objectCreator` or `roles/storage.objectAdmin`

## Comparison with AWS S3

| Feature | AWS S3 (url-to-s3) | GCS (url-to-gcs) |
|---------|-------------------|------------------|
| Max object size | 5 TB | 5 TB |
| Storage classes | 8 options | 4 options |
| Object versioning | Yes | Yes |
| Lifecycle policies | Yes | Yes |
| Metadata | Custom metadata | Custom metadata |
| Tags | Object tags | Labels (bucket-level) |
| ACLs | Canned ACLs | Predefined ACLs |
| Authentication | IAM roles/users | Service accounts/WIF |

## Development

### Setup

```bash
npm install
```

### Build

```bash
npm run build
```

This compiles TypeScript and bundles everything into `dist/index.js` using `@vercel/ncc`.

### Development Scripts

```bash
# Build the action (compile TypeScript + bundle with dependencies)
npm run build

# Run TypeScript type checking
npm run type-check

# Run ESLint
npm run lint

# Run all checks (type-check + lint)
npm run check
```

### Build Process

The build process uses `@vercel/ncc` to compile TypeScript and bundle all dependencies into a single `dist/index.js` file:

```bash
npm run build
```

**Output:**
- `dist/index.js` - Bundled action (includes Google Cloud SDK)
- `dist/index.js.map` - Source map for debugging
- `dist/licenses.txt` - License information for bundled dependencies

**Important:** The `dist/` directory **must be committed** to git. GitHub Actions runs the compiled code directly from the repository.

### Making Changes

1. **Edit source files** in `src/`
2. **Run checks** to validate:
   ```bash
   npm run check
   ```
3. **Build** to update `dist/`:
   ```bash
   npm run build
   ```
4. **Test locally** (optional) - Use a test GCP project
5. **Commit everything** including `dist/`:
   ```bash
   git add src/ dist/
   git commit -m "Description of changes"
   ```

### Release Process

Follow these steps to create a new release:

#### 1. Make and Test Changes

```bash
# Make your changes to src/
# Run checks
npm run check

# Build
npm run build

# Commit source and dist/
git add .
git commit -m "Add new feature"
git push origin main
```

#### 2. Create Version Tag

```bash
# Create annotated tag (use semantic versioning)
git tag -a v1.0.0 -m "Release v1.0.0: Initial release"

# Push tag to trigger release workflow
git push origin v1.0.0
```

#### 3. Automated Release

GitHub Actions automatically:
- ✓ Verifies `dist/` is committed
- ✓ Verifies `dist/` is up-to-date with source
- ✓ Creates GitHub Release with auto-generated notes
- ✓ Updates major version tag (e.g., `v1` → `v1.0.0`)

#### 4. Version References

Users can reference the action:
- **Recommended:** `predictr-io/url-to-gcs@v1` (floating major version, gets updates)
- **Pinned:** `predictr-io/url-to-gcs@v1.0.0` (specific version, never changes)

### Troubleshooting

**Release workflow fails with "dist/ is out of date":**
```bash
npm run build
git add dist/
git commit -m "Update dist/ for release"
git tag -f v1.0.0
git push -f origin v1.0.0
```

**ESLint errors:**
```bash
npm run lint
# Fix issues, then:
npm run check
```

**TypeScript errors:**
```bash
npm run type-check
```

## License

MIT

## Contributing

Contributions welcome! Please submit a Pull Request.
