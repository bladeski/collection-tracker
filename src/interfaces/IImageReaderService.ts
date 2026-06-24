export default interface IImageReaderService {
  readImage(
    image: HTMLImageElement | HTMLCanvasElement,
    pageSegMode?: Tesseract.PSM
  ): Promise<string>;
}