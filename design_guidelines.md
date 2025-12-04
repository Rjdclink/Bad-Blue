# Badge Check - Design Guidelines

## Design Approach

**System-Based Approach**: Drawing from Material Design and civic technology platforms (GovTech services, legal tech interfaces), prioritizing clarity, credibility, and accessibility for a police accountability tool.

**Core Principle**: Create a professional, trustworthy interface that conveys transparency and reliability while remaining accessible for field use and urgent situations.

---

## Typography

**Font Family**: Inter (primary), Roboto Mono (data/badge numbers)

**Hierarchy**:
- Hero/Landing Headlines: 48px (mobile: 32px), bold, tight line-height (1.1)
- Section Headers: 32px (mobile: 24px), semibold
- Card/Component Titles: 20px, semibold
- Body Text: 16px, regular, comfortable line-height (1.6)
- Officer Data Labels: 14px, medium, uppercase, letter-spacing (0.5px)
- Officer Data Values: 18px, semibold
- Badge Numbers: 24px, Roboto Mono, bold
- Legal/Disclaimer Text: 13px, regular
- Button Text: 15px, medium

---

## Layout System

**Spacing Units**: Tailwind units of 2, 4, 6, 8, 12, 16, 24 (p-2, m-4, gap-6, py-8, etc.)

**Container Strategy**:
- Marketing sections: max-w-7xl with px-4
- App content: max-w-6xl
- Forms/Upload areas: max-w-2xl
- Officer data cards: max-w-4xl

**Grid Patterns**:
- Feature grids: 3 columns desktop, 2 tablet, 1 mobile
- Pricing tiers: 2 columns side-by-side
- Search results: Single column with expandable cards

---

## Component Library

### Marketing/Landing Page Structure

**1. Hero Section** (90vh on desktop, natural height mobile)
- Large hero image: Civic/accountability themed (peaceful protest, community, justice scales)
- Centered content overlay with frosted glass effect backdrop
- Headline + supporting tagline
- Primary CTA (Get Started) with blurred background
- Trust indicator: "Powered by Public Records" badge
- Scroll indicator icon at bottom

**2. Value Proposition** (py-20)
- 3-column grid of core benefits
- Each with icon (shield, document, tracking icons from Heroicons)
- Headline + 2-3 sentence description
- "Transparency Through Technology" theme

**3. How It Works** (py-24)
- 4-step process visualization
- Step numbers (01, 02, 03, 04) in large Roboto Mono
- Icon + title + description for each step
- Upload → Analyze → Access Info → File/Track

**4. Tier Comparison** (py-20)
- Side-by-side pricing cards
- Basic ($10.99/mo) vs Premium ($19.99/mo)
- Clear feature lists with checkmarks
- Premium badge/indicator for recommended tier
- Both cards have CTA buttons

**5. Use Cases** (py-20)
- 2-column layout alternating image/text
- "For Journalists", "For Activists", "For Citizens"
- Real-world scenarios with supporting imagery

**6. Trust & Transparency** (py-16)
- Legal disclaimer about public records
- Data privacy statement
- Commitment to accuracy
- Contact for corrections/issues

**7. Footer** (py-12)
- Links: About, How It Works, Pricing, Privacy, Terms
- Social media icons
- Copyright and contact email

### Application Interface

**Navigation Bar**
- Fixed top position with subtle shadow
- Logo (left), nav items (center), subscription badge + user menu (right)
- Mobile: Hamburger menu
- Clear "Upgrade" button for basic tier users

**Upload Interface** (Main App Screen)
- Large drag-and-drop zone (min-height 400px mobile, 500px desktop)
- Dashed border when empty, solid when dragging
- Upload icon (Heroicons: camera or cloud-upload)
- "Drop badge photo here or click to browse"
- File requirements below (formats, size limit)
- Recent uploads gallery below (3-4 thumbnails)

**Officer Information Display**
- Card-based layout with clear sections:
  - **Header**: Badge number (large, Roboto Mono) + Department
  - **Officer Details**: Name, Rank, Years of Service (label-value pairs)
  - **Location**: Department address, jurisdiction
  - **Actions**: File Complaint button (primary), Save to History (secondary)
  - Premium users see: View Complaint Status, Advanced Analytics

**Complaint Filing Form** (Basic Tier)
- Single-column form layout
- Field groups with clear labels
- Incident details: Date, Time, Location (with map picker option)
- Description: Large textarea (min 6 rows)
- Evidence upload: Multiple file support
- Officer auto-populated from search
- Submit button with loading state
- Confirmation modal on submit

**Complaint Tracking Dashboard** (Premium Only)
- Table/card hybrid view of filed complaints
- Status badges: Filed, Under Review, Resolved, Closed
- Click to expand for full details
- Timeline visualization for each complaint
- Filter by status, date, department
- Export functionality (CSV, PDF)

**Subscription Management**
- Current plan card with:
  - Tier name and price
  - Billing date and payment method (managed by Square)
  - Feature access summary
  - Usage stats (searches this month)
- Upgrade/downgrade CTAs (redirects to Square hosted checkout)
- Billing history table (fetched from Square API)
- Cancel subscription link (subtle, bottom)

**Payment Flow (Square Hosted Checkout):**
- User clicks "Subscribe" or "Upgrade" button
- Backend creates Square checkout session
- User redirects to `https://square.link/...` (Square's secure payment page)
- Payment processed on Square's infrastructure
- After completion, Square redirects back to app with success/failure status
- Webhook updates subscription status in database
- User sees confirmation and can access premium features

**Note:** No embedded payment forms or SDK in the UI. All payment processing happens on Square's hosted pages for maximum security and PCI compliance.

**Search History** (All Tiers)
- Chronological list of badge lookups
- Each entry: Badge number, officer name, department, date
- Quick re-access button
- Filter by date range
- Premium: Export history

### Buttons & CTAs

**Primary Actions**: 
- Padding: px-6 py-3
- Border radius: rounded-lg
- Font weight: medium
- Icon + text when appropriate
- Blurred backdrop when over images

**Secondary Actions**:
- Outlined style with 2px border
- Same padding as primary
- Transparent background

**Icon Buttons**:
- Square aspect ratio (h-10 w-10)
- Rounded-md
- Icon from Heroicons (outline style)

### Cards & Containers

**Standard Card**:
- Border: 1px solid
- Border radius: rounded-xl
- Padding: p-6 (mobile: p-4)
- Shadow: subtle on light theme, none on dark

**Elevated Card** (pricing, features):
- Border: 2px solid
- Shadow: medium (shadow-lg)
- Padding: p-8

**Officer Data Card**:
- Section dividers (border-t within card)
- Generous padding: p-8
- Data in label-value pairs with gap-2

### Forms

**Input Fields**:
- Height: h-12
- Padding: px-4
- Border: 2px solid
- Rounded: rounded-lg
- Labels above with mb-2
- Helper text below with text-sm

**Textarea**:
- Min height: 150px
- Same styling as inputs

**File Upload**:
- Dashed border when empty
- Padding: p-8
- Center-aligned content
- File preview thumbnails in grid below

### Status & Feedback

**Status Badges**:
- Padding: px-3 py-1
- Rounded: rounded-full
- Text: text-xs font-medium uppercase
- Context-dependent styling (Filed, Resolved, etc.)

**Loading States**:
- Spinner icons from Heroicons
- Skeleton screens for data loading
- Progress indicators for uploads

**Error States**:
- Inline validation messages below inputs
- Toast notifications for system errors
- Empty states with helpful CTAs

---

## Images

**Hero Image**: Large, high-quality image depicting civic engagement, peaceful protest, or justice themes. Should convey transparency, accountability, and community empowerment. Full-width background image with dark overlay for text legibility.

**How It Works Section**: 4 supporting images showing:
1. Phone taking photo of badge
2. AI analysis visualization (abstract)
3. Officer information display
4. Complaint form interface

**Use Cases Section**: 3 images representing:
1. Journalist with notepad/camera
2. Community organizer/activist
3. Everyday citizen with smartphone

All images should feel authentic, diverse, and professional rather than stock-photo generic.

---

## Accessibility

- WCAG AA contrast ratios minimum
- All interactive elements keyboard navigable
- Focus indicators visible on all focusable elements (2px outline with offset)
- ARIA labels on icon-only buttons
- Form labels always visible (no placeholder-only patterns)
- Error messages announced to screen readers
- Responsive font sizes (16px minimum for body text)