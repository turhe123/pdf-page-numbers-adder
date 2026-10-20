# PDF Page Number Adder — specification

**Tagline:** Stamp page numbers on any PDF in your browser, with position, format and start number, no upload.

**Category:** PDF

**Free alternative to:** Sejda Add Page Numbers and PDF24 (uploads files, Sejda free limit of 3 tasks per hour and 50 pages, ads)

**Search phrases:** add page numbers to pdf, number pdf pages, pdf page numbering online, insert page numbers pdf free, bates numbering pdf, page x of y pdf

**Allowed libraries:** pdf-lib

**Published at:** https://turhe123.github.io/pdf-page-numbers-adder/

## Acceptance checks (each must have a test)

- loading the bundled 4 page sample and choosing bottom center produces a PDF with the same 4 pages
- the preview shows the label 1 of 4 on page 1 when the format Page X of Y is chosen
- setting start number 10 shows 10 on the first page
- skipping the first page leaves page 1 unnumbered
- layout works at 390px wide

## Spec

Adding page numbers to a PDF is a very common need for theses, legal bundles and reports. Search results show online tools such as Sejda and PDF24 that upload the file, and some limit free runs per hour or pages per file. Because the documents are often private or legal, a local version has clear value.

Our version does one job: print a page number label onto each page. No other text, no headers beyond the number format.

UI: a drop zone for one PDF. After loading, show a live preview of the first page with the label drawn over it using canvas, and a page stepper to view other pages. Options: position as a three by three grid of buttons (default bottom center), format (1, Page 1, 1 of N, Page 1 of N, i ii iii roman), start number (default 1), first page to number (default 1), skip first page checkbox, font size (default 11), margin in millimeters (default 12), font (Helvetica, Times, Courier) and color (default dark gray). Optional prefix text such as Doc 7 is allowed. Mirror for double sided option swaps left and right on even pages. An Apply and Download button saves name_numbered.pdf. Result line states pages numbered. Empty and error states are inline. Keyboard: arrow keys change preview page.

Technical approach: pdf-lib loads the file, embeds a standard font with embedFont, and for each page computes the label, measures width with widthOfTextAtSize, and calls drawText at the coordinates derived from the position grid and margins, honoring the page rotation by rotating the coordinates so the number appears upright. For preview, render the first page using a simple approach: because pdfjs is not required, the preview shows a schematic page box with the label placed at scaled coordinates, which keeps the tool lightweight. Standard fonts only cover Latin characters, so the prefix field warns on unsupported characters. Save to Blob and download.

Edge cases: pages with a crop box different from the media box use the crop box for placement, rotated pages need coordinate transforms, very large files are processed in a single pass with progress text, roman numerals above 3999 fall back to digits, encrypted files show an unsupported message, mobile Safari downloads happen on tap, and the number of pages is displayed so N is right even when skipping.

Demo data: a bundled fictional four page PDF, Thesis Draft by a student named Mira Okafor, with a title page, two body pages and a references page, one page in landscape.
