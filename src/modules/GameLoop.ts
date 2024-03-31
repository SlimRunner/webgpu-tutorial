
// use a proper game loop
// reference: https://stackoverflow.com/a/19772220

class GameLoop {
  fps: number;
  fpsInterval: number;
  drawCall: Function;
  timeOffset: number;
  frameOffset: number;
  time: number;
  timeInFrame: number;
  timeDelta: number;

  constructor(fps: number, drawCall: Function) {
    this.timeOffset = Date.now();
    this.frameOffset = 0;
    this.fps = fps;
    this.fpsInterval = 1000 / fps;
    this.drawCall = drawCall;
    this.time = 0;
    this.timeInFrame = 0;
    this.timeDelta = 0;
  }

  runLoop() {
    requestAnimationFrame(() => this.runLoop());

    const now = Date.now();
    const newTime = now - this.timeOffset;
    this.timeDelta = newTime - this.time;
    this.time = newTime;
    this.timeInFrame = now - this.frameOffset;

    if (this.timeInFrame > this.fpsInterval) {
      this.frameOffset = now - (this.timeInFrame % this.fpsInterval);

      this.drawCall();
    }
  }
}

export { GameLoop };
