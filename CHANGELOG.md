# Changelog

## 1.3.6

- Fixed a debounced-save race that reloaded stale file bytes and erased Undo/Redo history immediately after writing or moving content.
- Added direct engine regression tests for undoing handwriting and selection movement.

## 1.3.5

- Added reliable semantic-click fallback for every toolbar action, including rectangle, ellipse, Undo, and Redo.
- Added Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, and Ctrl/Cmd+Y shortcuts on active drawing surfaces.
- Persisted unfinished shape/stroke mutations when iPad sends pointercancel.
- Added focused regression coverage for the audited interaction paths.

## 1.3.4

- Added a mobile click fallback for Paper tone and line-style controls when iPad does not deliver a usable pointerup.
- Made repeated line-style selection idempotent so a fallback click cannot create duplicate history entries.

## 1.3.3

- Added automatic black/white ink contrast when switching between dark and light paper tones.
- Applied the same contrast behavior to SVG and PDF exports.
- Preserved two-finger pinch zoom while selection and shape tools ignore single-finger palms.
- Added Pencil pointer capture so rectangles and ellipses commit reliably when the pointer moves.
- Added startup toolbar routing retries for slow iPad workspace restoration.

## 1.3.2

- Fixed multi-step undo and redo history after asynchronous view/store attachment.
- Made standalone selection and shape tools ignore palm touch pointers instead of starting pan gestures.
- Added vault-native SVG and PDF export for the whole drawing or the current selection.
- Added Dark and Light board-tone controls under Paper style.
- Improved selection separation so lassoing a narrow area does not select a partially enclosed shape.

## 1.3.1

- Fixed moving lasso-selected handwriting groups.
- Changed lasso selection to require complete element containment, preventing partial box outlines from being selected.
- Made batch selection deletion consistent after tap and drag gestures.
- Improved toolbar icon contrast when switching between Obsidian light and dark themes.

## 1.3.0

- Added raw, natural, and pressure ink profiles.
- Added accurate mixed stroke/shape selection, batch deletion, shape resizing, recoloring, and line styles.
- Added visible SVG export for the whole drawing or the current selection.
- Added page-spacing presets and numeric spacing control.
- Moved the drawing toolbar to the top and the zoom indicator to the bottom-left.
- Fixed toolbar startup routing after Obsidian reloads.
- Improved iPad toolbar clipping and persistence safeguards.
