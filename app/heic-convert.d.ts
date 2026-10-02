declare module "heic-convert" {
  export default function convert(options: { buffer: Buffer; format: "JPEG" | "PNG"; quality?: number }): Promise<Buffer>;
}

declare module "heic-convert/browser" {
  export default function convert(options: { buffer: ArrayBuffer; format: "JPEG" | "PNG"; quality?: number }): Promise<ArrayBuffer>;
}
