# PRD: Manga Reader with OCR Dictionary Lookup

## Introduction

Add a manga reader to Jiten that lets Japanese learners read manga with intelligent dictionary lookup — something no existing app does well. Users import manga pages (camera photos, screenshots, or CBZ files), the app runs OCR via Google Cloud Vision API to extract Japanese text, then overlays furigana and enables tap-to-lookup on any word. Cross-device sync keeps manga libraries accessible on all devices.

This addresses a gap in the market: Japanese learners currently have no practical way to read manga with integrated dictionary lookup. Existing tools either have poor OCR for Japanese vertical text or require manual text entry.

## Goals

- Let users import manga pages from camera, photo library, or CBZ files
- Extract Japanese text from manga panels using Google Cloud Vision OCR
- Display furigana overlay on recognized kanji
- Enable tap-to-lookup dictionary popup on any recognized word
- Track reading progress (page position, bookmarks)
- Sync manga libraries and progress across devices for pro users
- Monetize via limited free OCR tier (X pages/month free, pro: unlimited + CBZ + sync)

## User Stories

### US-001: Import manga pages from camera/photos

**Description:** As a learner, I want to photograph or select manga pages so I can read them in the app.

**Acceptance Criteria:**

- [ ] "Add pages" button opens camera or photo picker (multi-select)
- [ ] Selected images are saved to local storage and displayed as thumbnails
- [ ] Pages can be reordered via drag-and-drop
- [ ] Pages can be deleted individually
- [ ] Typecheck passes

### US-002: Import CBZ manga volumes (Pro)

**Description:** As a pro user, I want to import CBZ files so I can read full manga volumes.

**Acceptance Criteria:**

- [ ] Import button accepts .cbz files via document picker
- [ ] CBZ is extracted and pages are loaded in order
- [ ] Volume metadata (title) is extracted from filename
- [ ] Progress indicator shown during extraction
- [ ] Free users see upgrade prompt when attempting CBZ import
- [ ] Typecheck passes

### US-003: OCR text extraction

**Description:** As a learner, I want the app to recognize Japanese text in my manga pages so I can look up words.

**Acceptance Criteria:**

- [ ] On import, all pages are sent to Google Cloud Vision API for OCR
- [ ] Batch progress shown (e.g., "Processing page 3/20...")
- [ ] OCR results (text + bounding boxes) stored locally per page
- [ ] Vertical Japanese text correctly ordered (right-to-left columns)
- [ ] Failed pages show error but don't block other pages
- [ ] Free tier: X pages/month tracked and enforced
- [ ] Typecheck passes

### US-004: Furigana overlay on manga pages

**Description:** As a learner, I want to see furigana above kanji in manga so I can read unfamiliar characters.

**Acceptance Criteria:**

- [ ] Toggle to show/hide furigana overlay on manga page
- [ ] Furigana positioned above horizontal text, right of vertical text
- [ ] Only kanji receive furigana (not kana-only words)
- [ ] Readings sourced from dictionary lookup of OCR'd words
- [ ] Overlay doesn't obscure manga art excessively
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-005: Tap-to-lookup dictionary popup

**Description:** As a learner, I want to tap any word on a manga page to see its dictionary definition.

**Acceptance Criteria:**

- [ ] Tapping on recognized text region shows dictionary popup
- [ ] Popup shows word, reading, pitch accent, meanings (reuse existing DictionaryPopup)
- [ ] Smart word boundary detection using existing `smartLookupWithOffset`
- [ ] Popup dismissible by tapping outside
- [ ] Can navigate to full word detail from popup
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-006: Page reader with gestures

**Description:** As a learner, I want to swipe through manga pages like a real manga reading experience.

**Acceptance Criteria:**

- [ ] Horizontal swipe navigation (right-to-left for Japanese reading order)
- [ ] Pinch-to-zoom on individual pages
- [ ] Double-tap to zoom to panel level
- [ ] Page number indicator
- [ ] Reading direction setting (RTL default, LTR option)
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-007: Reading progress and bookmarks

**Description:** As a learner, I want to resume reading where I left off and bookmark important pages.

**Acceptance Criteria:**

- [ ] Current page position saved automatically on navigation
- [ ] Reopening a volume resumes at last read page
- [ ] Long-press on page to add/remove bookmark
- [ ] Bookmarked pages shown in volume overview with visual indicator
- [ ] Typecheck passes

### US-008: Manga library management

**Description:** As a learner, I want to organize my manga volumes in a library view.

**Acceptance Criteria:**

- [ ] Grid view of manga volumes with cover thumbnails (first page)
- [ ] Volume title, page count, reading progress shown
- [ ] Sort by: last read, title, date added
- [ ] Delete volume with confirmation
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-009: Cross-device manga sync (Pro)

**Description:** As a pro user, I want my manga library available on all my devices.

**Acceptance Criteria:**

- [ ] Manga images uploaded to blob storage (R2/S3) on import
- [ ] New devices download manga images on demand (not all at once)
- [ ] Reading progress and bookmarks sync via existing delta sync
- [ ] OCR results sync with metadata (avoid re-OCR on second device)
- [ ] Sync status indicator per volume
- [ ] Free users see local-only indicator
- [ ] Typecheck passes

### US-010: OCR usage tracking and free tier

**Description:** As a business, I want to limit free OCR usage to manage costs while letting users try the feature.

**Acceptance Criteria:**

- [ ] Track OCR page count per user per month
- [ ] Free tier: 30 pages/month
- [ ] Show remaining OCR quota in manga import flow
- [ ] When quota exceeded: show upgrade prompt, block new OCR
- [ ] Pro users: unlimited OCR
- [ ] Already-OCR'd pages don't count against quota on re-sync
- [ ] Typecheck passes

## Functional Requirements

- FR-1: Camera/photo import via `expo-image-picker` with multi-select
- FR-2: CBZ extraction using JSZip (already in project or add dependency)
- FR-3: Google Cloud Vision API integration for `DOCUMENT_TEXT_DETECTION` with `ja` language hint
- FR-4: OCR text ordering: sort text blocks by x-coordinate descending (right-to-left) for vertical Japanese text, then by y-coordinate within columns
- FR-5: Store OCR results as JSON per page: `{ blocks: [{ text, boundingBox, words: [{ text, boundingBox }] }] }`
- FR-6: Furigana generation using existing dictionary lookup to find readings for kanji compounds
- FR-7: Tap hit-testing against OCR bounding boxes to identify tapped word
- FR-8: Dictionary popup reusing existing `DictionaryPopup` component and `smartLookupWithOffset`
- FR-9: Page reader using `FlatList` with horizontal paging (or `react-native-pager-view`)
- FR-10: Manga metadata stored in `manga_volumes` table (id, title, page_count, current_page, created_at, updated_at)
- FR-11: Manga pages stored in `manga_pages` table (id, volume_id, page_number, image_uri, ocr_result JSON, ocr_status)
- FR-12: Image blob sync via R2-compatible S3 API with presigned upload/download URLs
- FR-13: OCR quota tracked server-side via new `ocr_usage` table or API endpoint
- FR-14: Batch OCR on import with per-page progress callback
- FR-15: Image compression before upload (resize to max 2048px longest edge, JPEG quality 85)

## Non-Goals

- No automatic panel detection/splitting (show full pages)
- No text-to-speech for manga
- No manga downloading/scraping from external sources
- No translation overlay (this is a learning tool, not a translation tool)
- No social features (sharing, comments)
- No SRS integration with manga words (may add later)
- No support for non-Japanese manga OCR
- No PDF manga support in v1 (CBZ only for archives)

## Design Considerations

### UI/UX

- Manga tab added to main tab bar (or sub-tab under Reader)
- Library grid follows existing app design language (cards, themed colors)
- Dictionary popup identical to ebook reader popup for consistency
- Furigana toggle in reader toolbar (same position as ebook reader)
- Import flow: pick source → preview pages → confirm → OCR processing screen

### Existing Components to Reuse

- `components/DictionaryPopup.tsx` — tap-to-lookup popup UI
- `lib/smart-lookup.ts` — `smartLookupWithOffset()` for word boundary detection
- `lib/deinflect.ts` — verb/adjective deinflection for OCR'd text
- `components/BookmarkPopover.tsx` — bookmark UI pattern
- `db/sync-helpers.ts` — delta sync for metadata, blob sync pattern for images
- `db/user-migrations.ts` — migration pattern for new tables
- `lib/furigana.ts` (if exists) or ebook reader's furigana logic

### Building Blocks from honto-scanner

- `~/cs/honto-scanner/scanner.py` — Google Cloud Vision API integration pattern
  - `DOCUMENT_TEXT_DETECTION` feature type
  - `ja` language hints for Japanese
  - Vertical text ordering: sort paragraphs by x-coordinate descending
  - Bounding box vertex extraction
  - Retry with exponential backoff for API calls

## Technical Considerations

### OCR Architecture

- Client sends images to our Cloudflare Worker API endpoint (not directly to Google)
- Worker proxies to Google Cloud Vision (keeps API key server-side)
- Worker also enforces OCR quota per user
- Batch endpoint: accepts multiple images, returns results array
- Consider queuing for large volumes (20+ pages) to avoid timeout

### Storage Architecture

- **Local**: Images stored in app document directory (native) or OPFS (web)
- **Cloud**: R2 bucket for image blobs, ~$0.015/GB/month storage, free egress
- **Sync pattern**: Same as books `raw_content` blob sync — metadata via delta sync, images via separate blob upload/download
- **Image paths**: `manga/{userId}/{volumeId}/{pageNumber}.jpg`
- Presigned URLs generated by Cloudflare Worker for direct R2 upload/download

### Database Schema (new tables)

```sql
CREATE TABLE manga_volumes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  page_count INTEGER NOT NULL DEFAULT 0,
  current_page INTEGER NOT NULL DEFAULT 0,
  cover_image_uri TEXT,
  reading_direction TEXT NOT NULL DEFAULT 'rtl',
  is_synced INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE manga_pages (
  id TEXT PRIMARY KEY,
  volume_id TEXT NOT NULL REFERENCES manga_volumes(id) ON DELETE CASCADE,
  page_number INTEGER NOT NULL,
  image_uri TEXT NOT NULL,
  image_blob_key TEXT,  -- R2 key for cloud sync
  ocr_status TEXT NOT NULL DEFAULT 'pending',  -- pending | processing | done | error
  ocr_result TEXT,  -- JSON: bounding boxes + text
  ocr_error TEXT,
  is_bookmarked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE manga_bookmarks (
  id TEXT PRIMARY KEY,
  volume_id TEXT NOT NULL REFERENCES manga_volumes(id) ON DELETE CASCADE,
  page_number INTEGER NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL
);
```

### Cost Estimates

- Google Cloud Vision: $1.50/1000 images (first 1000/month free)
- R2 storage: $0.015/GB/month, free egress
- Typical manga volume: ~200 pages × ~500KB = ~100MB
- Free tier (30 pages/month): negligible cost
- Pro user reading 5 volumes/month: ~$1.50 OCR + ~$0.075 storage = ~$1.58/month

### Platform Considerations

- **iOS/Android**: `expo-image-picker` for camera/photos, `expo-file-system` for local storage
- **Web**: File input for photos, OPFS for local storage, no camera access
- CBZ extraction: JSZip works cross-platform
- Image rendering: `<Image>` with zoom via `react-native-gesture-handler` + `react-native-reanimated`

## Success Metrics

- Users can go from photographing a manga page to looking up a word in under 60 seconds
- OCR accuracy: >90% character recognition on typical manga (clean print, standard fonts)
- Reading session length comparable to ebook reader (>5 minutes average)
- Pro conversion rate from manga users higher than baseline (manga is the hook)
- Cross-device sync: manga available on second device within 30 seconds of import

## Open Questions

1. **Tab placement**: New "Manga" tab in main tab bar, or sub-section under existing Reader tab?
2. **OCR caching**: Should we cache OCR results server-side to avoid re-processing the same images across users? (copyright implications)
3. **Free tier limit**: 30 pages/month — is this enough to hook users but still drive conversion?
4. **Handwritten text**: Google Cloud Vision handles printed text well, but some manga has handwritten SFX — worth attempting or explicitly unsupported?
5. **Furigana conflicts**: Manga often has its own furigana — should we detect and skip those regions?
6. **Image quality**: Minimum resolution requirements for reliable OCR? Should we warn users about low-quality photos?
7. **Volume grouping**: Should users manually group pages into volumes, or should we auto-detect from CBZ structure only?
