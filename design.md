# UI/UX Design Specification — AliExpress to Shopify One-Click Importer

## 1. Design Principles

1. **Compact & Focused** — The entire interface fits within a standard 400×520px extension popup. No scrolling required for the primary workflow.
2. **Transparent & Honest** — Clearly display currencies, image import outcomes, and exact draft status. Never claim success before verification, and never hide partial image failures.
3. **Safe by Default** — Disable destructive or blind retries when transaction state is uncertain. Enforce Draft status visibility.
4. **Professional & Clean** — Shopify Polaris-inspired aesthetic (Shopify green `#008060`, neutral grays, clean typography).
5. **Accessible** — Full keyboard navigability, high contrast text (WCAG AA compliant), visible focus rings, and screen-reader status announcements.

## 2. Popup Dimensions and Visual Hierarchy

- **Dimensions:** 400px width (fixed), up to 520px height (flexible content area).
- **Typography:** System font stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`).
- **Color Palette:**
  - Primary / Success: `#008060` (Shopify green)
  - Primary Hover: `#006e52`
  - Critical / Error: `#d72c0d`
  - Warning / Alert: `#b98900`
  - Text Primary: `#202223`
  - Text Secondary: `#6d7175`
  - Background: `#ffffff`
  - Surface Subdued: `#f6f6f7`
  - Border: `#e1e3e5`

## 3. UI State Machine and Layouts

The extension popup operates across distinct, mutually exclusive states:

```
[Disconnected] ──(Connect)──> [OAuth Flow] ──(Success)──> [Connected / Idle]
                                                                  │
                                      ┌───────────────────────────┴───────────────────────────┐
                                      │ (On Non-AliExpress Tab)                               │ (On AliExpress PDP)
                                      ▼                                                       ▼
                            [Non-AliExpress Page]                                       [Extracting]
                                                                                              │
                                                                  ┌───────────────────────────┼───────────────────────────┐
                                                                  ▼                           ▼                           ▼
                                                         [Unsupported Product]       [Currency Mismatch]              [Preview]
                                                         (e.g., > 3 options)         (e.g., CNY vs USD)                   │
                                                                                                                          │ (Click Import)
                                                                                                                          ▼
                                                                                                                     [Importing]
                                                                                                                          │
                                                  ┌───────────────────────────┬───────────────────────────┬───────────────┴───────────────┐
                                                  ▼                           ▼                           ▼                               ▼
                                            [Full Success]         [Partial Image Success]          [Duplicate]                [Uncertain Outcome]
                                            (All images OK)        (e.g., 3/5 images OK)            (Already exists)           (Timeout / Reconcile)
```

---

### 3.1 Disconnected State

Shown when the extension is not authenticated with any Shopify store.

```
┌─────────────────────────────────────┐
│  🔗  AliExpress → Shopify Importer │
│─────────────────────────────────────│
│                                     │
│     ┌───────────────────────┐       │
│     │    🏪                 │       │
│     │  Connect your Shopify │       │
│     │  store to get started │       │
│     └───────────────────────┘       │
│                                     │
│  Store domain:                      │
│  ┌─────────────────────────────┐    │
│  │ mystore.myshopify.com       │    │
│  └─────────────────────────────┘    │
│                                     │
│  ┌─────────────────────────────┐    │
│  │     Connect Shopify Store   │    │
│  └─────────────────────────────┘    │
│                                     │
│  🔒 Authenticates securely via      │
│     Shopify Dev Dashboard OAuth     │
└─────────────────────────────────────┘
```

- Input automatically appends `.myshopify.com` if omitted.
- Clicking "Connect Shopify Store" initiates OAuth in a new browser tab.
- Button is disabled while connection is pending.

---

### 3.2 Connected State — Non-AliExpress Page

Shown when connected, but the active tab is not an AliExpress item detail page.

```
┌─────────────────────────────────────┐
│  🔗  AliExpress → Shopify Importer │
│─────────────────────────────────────│
│  🟢 Connected: My Store (USD)       │
│─────────────────────────────────────│
│                                     │
│     ┌───────────────────────┐       │
│     │    📦                 │       │
│     │  Navigate to an       │       │
│     │  AliExpress product   │       │
│     │  page to import       │       │
│     └───────────────────────┘       │
│                                     │
│                    ┌──────────────┐  │
│                    │ Disconnect   │  │
│                    └──────────────┘  │
└─────────────────────────────────────┘
```

---

### 3.3 Extracting State

Shown while the content script extracts product metadata and currency.

```
┌─────────────────────────────────────┐
│  🔗  AliExpress → Shopify Importer │
│─────────────────────────────────────│
│  🟢 Connected: My Store (USD)       │
│─────────────────────────────────────│
│                                     │
│         ⟳ Extracting product        │
│           data & currency...        │
│                                     │
│         ████████░░░░░░░░░           │
│                                     │
└─────────────────────────────────────┘
```

---

### 3.4 Product Preview State (Primary Action Screen)

Shown after successful data extraction and currency matching.

```
┌─────────────────────────────────────┐
│  🔗  AliExpress → Shopify Importer │
│─────────────────────────────────────│
│  🟢 Connected: My Store (USD)       │
│─────────────────────────────────────│
│  ┌──────┐                           │
│  │      │  Wireless Bluetooth       │
│  │ IMG  │  Earbuds TWS Noise...     │
│  │      │                           │
│  └──────┘  🏷️ 3 variants (Color)    │
│            📸 5 images               │
│─────────────────────────────────────│
│  Source Price:        $12.99 USD    │
│                                     │
│  Markup:  ┌──────┐                  │
│           │  30  │ %                │
│           └──────┘                  │
│                                     │
│  Selling Price:       $16.89 USD    │
│─────────────────────────────────────│
│                                     │
│  ┌─────────────────────────────┐    │
│  │    ⬆️  Import to Shopify     │    │
│  └─────────────────────────────┘    │
│                                     │
│  Product will be created as Draft   │
└─────────────────────────────────────┘
```

**Key Elements:**
- **Store & Currency Banner:** Displays store name and matched currency (`USD`).
- **Product Thumbnail & Summary:** 64×64px image, truncated title, option breakdown, image count.
- **Explicit Currency Codes:** Both Source Price and Calculated Selling Price clearly indicate the currency code (`USD`).
- **Real-Time Markup Calculation:** Decimal-safe calculation updates live with half-up rounding as markup changes.
- **Draft Notice:** Prominently communicates that the product will be created as a Draft.

---

### 3.5 Currency Mismatch Error State

Shown when AliExpress displays prices in a currency different from the Shopify store currency.

```
┌─────────────────────────────────────┐
│  🔗  AliExpress → Shopify Importer │
│─────────────────────────────────────│
│  🟢 Connected: My Store (USD)       │
│─────────────────────────────────────│
│                                     │
│     ┌───────────────────────┐       │
│     │    ⚠️ Currency Mismatch│      │
│     └───────────────────────┘       │
│                                     │
│  AliExpress currency: EUR (€11.50)  │
│  Shopify store currency: USD        │
│                                     │
│  Automatic currency conversion is   │
│  not supported to avoid pricing     │
│  inaccuracies.                      │
│                                     │
│  👉 Please switch your AliExpress   │
│     currency setting to USD and     │
│     refresh this page.              │
│                                     │
│  ┌─────────────────────────────┐    │
│  │        Refresh Page         │    │
│  └─────────────────────────────┘    │
└─────────────────────────────────────┘
```

---

### 3.6 Unsupported Product State (> 3 Options)

Shown when an AliExpress product contains more than 3 option dimensions (e.g., Color + Size + Material + Plug Type).

```
┌─────────────────────────────────────┐
│  🔗  AliExpress → Shopify Importer │
│─────────────────────────────────────│
│  🟢 Connected: My Store (USD)       │
│─────────────────────────────────────│
│                                     │
│     ┌───────────────────────┐       │
│     │    ⛔ Unsupported      │       │
│     └───────────────────────┘       │
│                                     │
│  This product has 4 option types:   │
│  Color, Size, Material, Plug.       │
│                                     │
│  Shopify supports a maximum of      │
│  3 options per product.             │
│                                     │
│  To prevent data corruption, this   │
│  product cannot be imported.        │
│                                     │
│  ┌─────────────────────────────┐    │
│  │            Close            │    │
│  └─────────────────────────────┘    │
└─────────────────────────────────────┘
```

---

### 3.7 Importing State

Shown while the backend executes the reservation and Shopify `productSet` mutation.

```
┌─────────────────────────────────────┐
│  🔗  AliExpress → Shopify Importer │
│─────────────────────────────────────│
│  🟢 Connected: My Store (USD)       │
│─────────────────────────────────────│
│  ┌──────┐                           │
│  │ IMG  │  Wireless Bluetooth...    │
│  └──────┘                           │
│─────────────────────────────────────│
│                                     │
│         ⟳ Creating Draft in         │
│           Shopify...                │
│                                     │
│  ┌─────────────────────────────┐    │
│  │    ⏳ Importing...           │    │
│  └─────────────────────────────┘    │
│         (Button disabled)           │
│                                     │
└─────────────────────────────────────┘
```

---

### 3.8 Full Success State

Shown when the product, variants, and all images are created successfully.

```
┌─────────────────────────────────────┐
│  🔗  AliExpress → Shopify Importer │
│─────────────────────────────────────│
│  🟢 Connected: My Store (USD)       │
│─────────────────────────────────────│
│                                     │
│     ┌───────────────────────┐       │
│     │    ✅ Success!        │       │
│     │  Draft Product Created│       │
│     └───────────────────────┘       │
│                                     │
│  Wireless Bluetooth Earbuds TWS     │
│  • 3 variants created               │
│  • 5 of 5 images imported           │
│  • Price: $16.89 USD                │
│  • Status: Draft                    │
│                                     │
│  ┌─────────────────────────────┐    │
│  │  🔗 View in Shopify Admin   │    │
│  └─────────────────────────────┘    │
│                                     │
│  ┌─────────────────────────────┐    │
│  │    Import Another Product   │    │
│  └─────────────────────────────┘    │
└─────────────────────────────────────┘
```

---

### 3.9 Partial Image Success State

Shown when the product and variants were created as Draft, but some images failed to attach.

```
┌─────────────────────────────────────┐
│  🔗  AliExpress → Shopify Importer │
│─────────────────────────────────────│
│  🟢 Connected: My Store (USD)       │
│─────────────────────────────────────│
│                                     │
│     ┌───────────────────────┐       │
│     │    ⚠️ Partial Import   │       │
│     │  Product Created      │       │
│     └───────────────────────┘       │
│                                     │
│  Product created as Draft, but:     │
│  ⚠️ 2 of 5 images failed to import. │
│                                     │
│  You can add missing images         │
│  manually in Shopify Admin.         │
│                                     │
│  ┌─────────────────────────────┐    │
│  │  🔗 View in Shopify Admin   │    │
│  └─────────────────────────────┘    │
│                                     │
│  ┌─────────────────────────────┐    │
│  │             Done            │    │
│  └─────────────────────────────┘    │
└─────────────────────────────────────┘
```

---

### 3.10 Uncertain Outcome State (Ambiguous Timeout / Reconcile)

Shown when the mutation timed out or connection was lost; **no blind retry button is offered**.

```
┌─────────────────────────────────────┐
│  🔗  AliExpress → Shopify Importer │
│─────────────────────────────────────│
│  🟢 Connected: My Store (USD)       │
│─────────────────────────────────────│
│                                     │
│     ┌───────────────────────┐       │
│     │    ❓ Outcome Unknown │       │
│     └───────────────────────┘       │
│                                     │
│  The import request was sent to     │
│  Shopify, but the connection timed  │
│  out before confirmation.           │
│                                     │
│  ⚠️ Do NOT retry immediately.       │
│  The product may have been created. │
│                                     │
│  Please verify in your store:       │
│                                     │
│  ┌─────────────────────────────┐    │
│  │  🔗 Check Shopify Admin     │    │
│  └─────────────────────────────┘    │
│                                     │
│  (Next import attempt will auto-    │
│   reconcile this product)           │
└─────────────────────────────────────┘
```

---

### 3.11 Reauthorization Required State

Shown when Shopify returns HTTP 401 (e.g., app uninstalled or credentials revoked).

```
┌─────────────────────────────────────┐
│  🔗  AliExpress → Shopify Importer │
│─────────────────────────────────────│
│  🔴 Session Expired                 │
│─────────────────────────────────────│
│                                     │
│     ┌───────────────────────┐       │
│     │    🔒 Re-auth Needed  │       │
│     └───────────────────────┘       │
│                                     │
│  Shopify authorization has expired  │
│  or was revoked.                    │
│                                     │
│  Please reconnect your store to     │
│  continue importing products.       │
│                                     │
│  ┌─────────────────────────────┐    │
│  │      Reconnect Shopify      │    │
│  └─────────────────────────────┘    │
└─────────────────────────────────────┘
```

---

### 3.12 Duplicate State

Shown when attempting to import a product that has already been imported.

```
┌─────────────────────────────────────┐
│  🔗  AliExpress → Shopify Importer │
│─────────────────────────────────────│
│  🟢 Connected: My Store (USD)       │
│─────────────────────────────────────│
│                                     │
│     ┌───────────────────────┐       │
│     │    ℹ️ Already Imported │       │
│     └───────────────────────┘       │
│                                     │
│  This AliExpress product was        │
│  previously imported on Oct 28.     │
│                                     │
│  Status: Draft                      │
│                                     │
│  ┌─────────────────────────────┐    │
│  │  🔗 View in Shopify Admin   │    │
│  └─────────────────────────────┘    │
└─────────────────────────────────────┘
```

## 4. Component Inventory

| Component | Selector / Usage | Details |
|-----------|------------------|---------|
| Header Bar | `#app-header` | Logo icon, app title, connection status pill with currency |
| Store Badge | `#store-badge` | Displays active store name and base currency |
| Domain Input | `#shop-domain-input` | Sanitizes input; auto-completes `.myshopify.com` |
| Product Thumbnail | `#preview-thumb` | 64×64px image with object-fit cover and placeholder fallback |
| Title Truncation | `.product-title` | CSS `-webkit-line-clamp: 2` with tooltip for full title |
| Currency Pill | `.currency-pill` | Explicit badge showing currency code (e.g., `USD`) |
| Markup Input | `#markup-input` | Numeric input with 0–1000% validation, real-time recalculation |
| Selling Price | `#selling-price` | Formatted decimal string with currency code |
| Primary Action Button | `#btn-primary` | Green `#008060`, full width, prominent "Import to Shopify" |
| Admin Link Button | `#btn-admin-link` | Secondary outlined button opening Shopify Admin in new tab |
| Error Alert Card | `.alert-card` | Contextual alert box (red, amber, or blue) with iconography |
| Progress Bar | `.progress-bar` | Subtle CSS animated pulse during extraction/import |

## 5. Accessibility Specifications

- **Keyboard Navigation:** Sequential `tabindex` order across inputs, buttons, and external links.
- **Contrast Ratios:** Text-to-background contrast exceeds WCAG AA standards (minimum 4.5:1).
- **ARIA Live Regions:** Live status announcements (`aria-live="polite"`) for state transitions during extraction and import.
- **Alert Semantics:** Errors and critical warnings use `role="alert"`.
- **Form Association:** All form inputs have explicit `<label>` tags with matching `for`/`id` attributes.
