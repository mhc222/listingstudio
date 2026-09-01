export type StreamingZipEntry = {
  name: string
  data: () => Promise<Uint8Array>
}

type CentralRecord = {
  name: Uint8Array
  crc: number
  size: number
  offset: number
  time: number
  date: number
}

const encoder = new TextEncoder()
const CRC_TABLE = new Uint32Array(256)
for (let number = 0; number < 256; number += 1) {
  let crc = number
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1)
  CRC_TABLE[number] = crc >>> 0
}

export function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function dosDateTime(date: Date) {
  const year = Math.max(1980, date.getUTCFullYear())
  return {
    time: (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | Math.floor(date.getUTCSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate(),
  }
}

function bytes(length: number, write: (view: DataView) => void) {
  const array = new Uint8Array(length)
  write(new DataView(array.buffer))
  return array
}

function localHeader(name: Uint8Array, time: number, date: number) {
  const header = bytes(30, (view) => {
    view.setUint32(0, 0x04034b50, true)
    view.setUint16(4, 20, true)
    view.setUint16(6, 0x0808, true) // data descriptor + UTF-8
    view.setUint16(8, 0, true) // stored; transformed JPEG/WebP/PNG need no second compression
    view.setUint16(10, time, true)
    view.setUint16(12, date, true)
    view.setUint16(26, name.length, true)
  })
  return [header, name]
}

function dataDescriptor(crc: number, size: number) {
  return bytes(16, (view) => {
    view.setUint32(0, 0x08074b50, true)
    view.setUint32(4, crc, true)
    view.setUint32(8, size, true)
    view.setUint32(12, size, true)
  })
}

function centralHeader(record: CentralRecord) {
  const header = bytes(46, (view) => {
    view.setUint32(0, 0x02014b50, true)
    view.setUint16(4, 20, true)
    view.setUint16(6, 20, true)
    view.setUint16(8, 0x0808, true)
    view.setUint16(10, 0, true)
    view.setUint16(12, record.time, true)
    view.setUint16(14, record.date, true)
    view.setUint32(16, record.crc, true)
    view.setUint32(20, record.size, true)
    view.setUint32(24, record.size, true)
    view.setUint16(28, record.name.length, true)
    view.setUint32(42, record.offset, true)
  })
  return [header, record.name]
}

function endRecord(count: number, centralSize: number, centralOffset: number) {
  return bytes(22, (view) => {
    view.setUint32(0, 0x06054b50, true)
    view.setUint16(8, count, true)
    view.setUint16(10, count, true)
    view.setUint32(12, centralSize, true)
    view.setUint32(16, centralOffset, true)
  })
}

export function createStreamingZip(entries: StreamingZipEntry[], generatedAt = new Date()) {
  if (entries.length > 65535) throw new Error("ZIP entry limit exceeded.")
  const { time, date } = dosDateTime(generatedAt)

  async function* generate() {
    let offset = 0
    const central: CentralRecord[] = []
    for (const entry of entries) {
      const name = encoder.encode(entry.name)
      const entryOffset = offset
      for (const chunk of localHeader(name, time, date)) {
        offset += chunk.length
        yield chunk
      }
      const data = await entry.data()
      if (data.length > 0xffffffff || offset + data.length > 0xffffffff) {
        throw new Error("Package exceeds the supported 4 GB ZIP limit. Use a smaller delivery profile.")
      }
      const crc = crc32(data)
      for (let start = 0; start < data.length; start += 64 * 1024) {
        const chunk = data.subarray(start, Math.min(data.length, start + 64 * 1024))
        offset += chunk.length
        yield chunk
      }
      const descriptor = dataDescriptor(crc, data.length)
      offset += descriptor.length
      yield descriptor
      central.push({ name, crc, size: data.length, offset: entryOffset, time, date })
    }

    const centralOffset = offset
    for (const record of central) {
      for (const chunk of centralHeader(record)) {
        offset += chunk.length
        yield chunk
      }
    }
    const centralSize = offset - centralOffset
    yield endRecord(central.length, centralSize, centralOffset)
  }

  const iterator = generate()
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await iterator.next()
        if (next.done) controller.close()
        else controller.enqueue(next.value)
      } catch (error) {
        controller.error(error)
      }
    },
    async cancel() {
      await iterator.return?.()
    },
  })
}
