# Location Intelligence System

Legal GPS extraction and location aggregation for OSINT, skip tracing, and investigative journalism.

## Legal Use Cases

✅ **Skip Tracing** - Lawyers finding defendants  
✅ **Investigative Journalism** - Source location research  
✅ **OSINT Research** - Public data aggregation  
✅ **Missing Persons** - Legal searches  

## Data Sources (All Public)

- EXIF GPS from publicly shared images
- Social media geotags (user-shared)
- Court records (public addresses)
- Property records (public databases)

## Installation

```bash
# Ubuntu/Debian
sudo apt-get install libimage-exiftool-perl

# macOS
brew install exiftool

# Windows
# Download from https://exiftool.org/
```

## API Usage

```bash
POST /api/location-intel/analyze
{
  "imagePaths": ["/path/to/image.jpg"],
  "publicRecords": [
    {
      "latitude": 40.7128,
      "longitude": -74.0060,
      "source": "court_record",
      "timestamp": "2024-01-15"
    }
  ]
}
```

## Legal Notice

This tool aggregates **public data only** for:
- Legal professionals (skip tracing)
- Journalists (investigative research)
- OSINT analysts (public information)

All sources must be legally accessible public records.
