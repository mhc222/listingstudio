import sharp from "sharp"

const TILE_WIDTH = 360
const TILE_HEIGHT = 270
const LABEL_HEIGHT = 34
const COLUMNS = 4
const ROWS = 3
const PER_SHEET = COLUMNS * ROWS

type SheetPhoto = { id: string; url: string; index: number }

function escapeXml(value: string) {
  return value.replace(/[<>&'\"]/g, (character) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    "'": "&apos;",
    '"': "&quot;",
  })[character] ?? character)
}

async function tile(photo: SheetPhoto) {
  const response = await fetch(photo.url)
  if (!response.ok) throw new Error(`photo ${photo.id} could not be read`)
  const image = await sharp(Buffer.from(await response.arrayBuffer()))
    .rotate()
    .resize(TILE_WIDTH, TILE_HEIGHT - LABEL_HEIGHT, { fit: "cover" })
    .jpeg({ quality: 78 })
    .toBuffer()
  const label = Buffer.from(
    `<svg width="${TILE_WIDTH}" height="${LABEL_HEIGHT}"><rect width="100%" height="100%" fill="#1b1917"/><text x="14" y="23" fill="white" font-size="16" font-family="Arial, sans-serif">${escapeXml(`Photo ${photo.index + 1}`)}</text></svg>`
  )
  return sharp({
    create: {
      width: TILE_WIDTH,
      height: TILE_HEIGHT,
      channels: 3,
      background: "#e9e3d9",
    },
  })
    .composite([
      { input: image, left: 0, top: 0 },
      { input: label, left: 0, top: TILE_HEIGHT - LABEL_HEIGHT },
    ])
    .jpeg({ quality: 82 })
    .toBuffer()
}

export async function buildRoomAnalysisSheets(photos: Array<{ id: string; url: string }>) {
  const sheets: Buffer[] = []
  const failedPhotoIds: string[] = []
  for (let start = 0; start < photos.length; start += PER_SHEET) {
    const batch = photos.slice(start, start + PER_SHEET)
    const rendered = await Promise.all(
      batch.map(async (photo, offset) => {
        try {
          return { index: start + offset, buffer: await tile({ ...photo, index: start + offset }) }
        } catch {
          failedPhotoIds.push(photo.id)
          return null
        }
      })
    )
    const valid = rendered.flatMap((item) => item ? [item] : [])
    if (!valid.length) continue
    const height = Math.ceil(valid.length / COLUMNS) * TILE_HEIGHT
    const sheet = await sharp({
      create: {
        width: COLUMNS * TILE_WIDTH,
        height,
        channels: 3,
        background: "#d8d0c4",
      },
    })
      .composite(
        valid.map((item, position) => ({
          input: item.buffer,
          left: (position % COLUMNS) * TILE_WIDTH,
          top: Math.floor(position / COLUMNS) * TILE_HEIGHT,
        }))
      )
      .jpeg({ quality: 82 })
      .toBuffer()
    sheets.push(sheet)
  }
  return { sheets, failedPhotoIds }
}
