# Changelog

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
