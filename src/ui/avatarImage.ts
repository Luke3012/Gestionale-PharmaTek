/** Ritaglia un'immagine al centro in un PNG quadrato 256x256. */
export async function cropAvatarTo256(file: File): Promise<{ bytes: number[]; dataUrl: string }> {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const candidate = new Image();
      candidate.onload = () => resolve(candidate);
      candidate.onerror = reject;
      candidate.src = url;
    });
    const size = 256;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d")!;
    const sourceSize = Math.min(image.width, image.height);
    context.drawImage(
      image,
      (image.width - sourceSize) / 2,
      (image.height - sourceSize) / 2,
      sourceSize,
      sourceSize,
      0,
      0,
      size,
      size
    );
    const dataUrl = canvas.toDataURL("image/png");
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((value) => resolve(value!), "image/png")
    );
    const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
    return { bytes, dataUrl };
  } finally {
    URL.revokeObjectURL(url);
  }
}
