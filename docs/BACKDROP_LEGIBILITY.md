# Keeping text readable on a purchased backdrop

The default page ground is plain white and the ink on it is black. That is the
baseline this whole document is about protecting: the ground is the one thing
coins can buy, so until someone buys a sky, the site is white paper.

A site backdrop repaints that entire ground. Every text color in `globals.css`
was chosen against white, and half the scenes in the shop are night, so
equipping one used to take body copy from comfortable to invisible.

This is the record of how the fix was measured, so that scene number eleven
gets the same treatment instead of a guess.

## What was actually wrong

Contrast of the shipped ink against the worst region of each scene, before
any of this. WCAG AA for body text is **4.5:1**.

| Scene | Worst region | `text-on-surface-variant` | `text-primary` |
| --- | --- | --- | --- |
| Starry night | `#080620` night sky | **1.02** | 2.32 |
| Downtown | `#0d0a28` towers | **1.01** | 2.25 |
| Sunset | `#2a1440` hills | **1.18** | 1.93 |
| The woods | `#1f3d34` pines | 1.64 | **1.38** |
| The suburbs | `#004e89` roof | 2.27 | **1.00** |
| The mountains | `#33526b` ridge | 2.37 | **1.04** |
| The village | `#a85b38` roof | 3.90 | 1.72 |
| Open grass | `#5f8f4e` field | 5.11 | 2.25 |
| The beach | `#5b8fb2` sea | 5.57 | 2.45 |
| Broad daylight | `#9fd0ee` sky | 11.78 | 5.19 |

Two things fall out of this table. It is not only the night scenes — pale
scenes have near-black pines and lapis roofs, and blue headings vanish on
those. And no single ink can fix a scene, because a scene is not one value:
Woodsy is a paper-pale sky **and** near-black pines, and a paragraph scrolls
across both.

## The two mechanisms

**1. Tone picks the ink.** `SiteBackdrop` stamps `data-backdrop-tone` on
`<html>`; `globals.css` re-points the text to chalk over the night scenes and
keeps it black over the pale ones. Surfaces that bring their own background —
the cards, the header, the footer, the pale warm panels — put the normal
palette straight back, because a white card still wants dark text whatever the
sky is doing behind it.

This is also why a bar, chip or pill that text sits on should be an **opaque**
fill rather than a translucent tint. A tint lets the sky through, so it has to
take the ground's ink, and a pale tint plus chalk ink is unreadable — that is
exactly how the leaderboard podium's `bg-accent/25` self bar ended up at
3.6:1 over the night scenes.

Only the **text** is re-pointed, never the design tokens. `--color-accent-strong`
is the fill under 52 buttons as well as the color of a link; re-pointing the
token would have turned every primary button on the site brown.

**2. A veil closes the scene's range.** `BACKDROP_SCRIM` in
`components/Backdrop.tsx` lays a wash of the tone's own base color over each
drawing, until the worst region clears AA against the ink. It is drawn as the
last rect inside the SVG, so it crops with the art and the shop preview shows
what you actually get.

## The numbers, and how they were measured

Guessing these from the SVG source was wrong twice — it over-veiled Downtown
(whose lit windows are tiny and average away under a glyph) and under-veiled
Sunset (whose sun is far brighter than its sky). So they are measured off
rendered pixels instead:

1. Render the scene to a canvas at 1440x960, the size it is actually seen at.
2. Downsample so each pixel is the average of an 8x8 and a 16x16 block — that
   is the ground *behind a glyph*, which is what contrast is really about, not
   the worst single pixel.
3. Composite the veil over every block and take the true worst one.
4. Solve for the smallest veil where all five ground inks clear **4.7:1** —
   AA plus headroom for rounding and resampling.

No scene pays for another's worst case:

| Scene | Tone | Veil | Worst measured contrast |
| --- | --- | --- | --- |
| Broad daylight | light | 0% | 7.76 |
| The beach | light | 20% | 4.66 |
| Open grass | light | 22% | 4.71 |
| The village | light | 34% | 4.77 |
| Downtown | dark | 43% | 4.83 |
| The mountains | light | 45% | 4.74 |
| The suburbs | light | 48% | 4.73 |
| The woods | light | 52% | 4.81 |
| Starry night | dark | 53% | 4.85 |
| Sunset | dark | 56% | 4.81 |

## Why the ground ink is nearly monochrome

`--ground-accent` is `#522211` on pale scenes and `#ffded3` on night ones —
barely orange. That is not timidity, it is the arithmetic: the strongest hue
that clears 4.5:1 against a mid-tone photographic ground is close to neutral.
Saturated brand color survives on cards and buttons, where the background is
ours to choose. The hero's gradient word is rebuilt from the same ground
palette, since `background-clip: text` means no `color` rule reaches it.

## Adding a scene

`BACKDROP_TONE` and `BACKDROP_SCRIM` are `Record<BackdropSceneId, …>`, so a new
id fails the build until both are filled in. Start at the tone the sky reads
as, then measure — do not eyeball the veil. The failure mode is silent: the
page still renders, it just cannot be read.
