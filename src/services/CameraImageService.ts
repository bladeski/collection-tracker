export class CameraImageService {
  private video: HTMLVideoElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private stream: MediaStream | null = null;
  private animationFrameId: number | null = null;

  /**
   * Initialize camera access and setup video element
   */
  async initializeCamera(): Promise<void> {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
        audio: false,
      });

      this.video = document.createElement('video');
      this.video.srcObject = this.stream;
      this.video.play();
    } catch (error) {
      console.error('Error accessing camera:', error);
      throw new Error('Unable to access device camera');
    }
  }

  /**
   * Setup canvas for displaying camera feed
   */
  setupCanvas(canvasElement: HTMLCanvasElement): void {
    this.canvas = canvasElement;
    if (this.video) {
      this.canvas.width = this.video.videoWidth || 640;
      this.canvas.height = this.video.videoHeight || 480;
    }
  }

  /**
   * Start streaming camera feed to canvas
   */
  startCapture(): void {
    if (!this.video || !this.canvas) {
      throw new Error('Camera or canvas not initialized');
    }

    const context = this.canvas.getContext('2d');
    if (!context) {
      throw new Error('Unable to get canvas 2D context');
    }

    const captureFrame = () => {
      context.drawImage(this.video!, 0, 0, this.canvas!.width, this.canvas!.height);
      this.animationFrameId = requestAnimationFrame(captureFrame);
    };

    captureFrame();
  }

  /**
   * Stop camera feed capture
   */
  stopCapture(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  /**
   * Release camera resources
   */
  releaseCamera(): void {
    this.stopCapture();

    if (this.video) {
      this.video.pause();
      this.video.srcObject = null;
    }

    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
  }

  /**
   * Capture current frame as image data
   */
  captureFrame(): ImageData | null {
    if (!this.canvas) {
      return null;
    }

    const context = this.canvas.getContext('2d');
    return context?.getImageData(0, 0, this.canvas.width, this.canvas.height) || null;
  }

  /**
   * Get current video element
   */
  getVideoElement(): HTMLVideoElement | null {
    return this.video;
  }

  /**
   * Get current canvas element
   */
  getCanvasElement(): HTMLCanvasElement | null {
    return this.canvas;
  }
}
