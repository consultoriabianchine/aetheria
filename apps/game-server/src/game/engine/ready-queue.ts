export interface ReadyQueueItem {
  readyAt: number;
}

export class ReadyQueue<T extends ReadyQueueItem> {
  private items: T[] = [];

  get size(): number {
    return this.items.length;
  }

  push(item: T) {
    this.items.push(item);
    this.bubbleUp(this.items.length - 1);
  }

  peek(): T | undefined {
    return this.items[0];
  }

  pop(): T | undefined {
    if (this.items.length === 0) return undefined;
    const root = this.items[0];
    const last = this.items.pop();
    if (last && this.items.length > 0) {
      this.items[0] = last;
      this.sinkDown(0);
    }
    return root;
  }

  private bubbleUp(index: number) {
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.items[parent].readyAt <= this.items[index].readyAt) break;
      this.swap(parent, index);
      index = parent;
    }
  }

  private sinkDown(index: number) {
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;
      if (left < this.items.length && this.items[left].readyAt < this.items[smallest].readyAt) smallest = left;
      if (right < this.items.length && this.items[right].readyAt < this.items[smallest].readyAt) smallest = right;
      if (smallest === index) break;
      this.swap(index, smallest);
      index = smallest;
    }
  }

  private swap(a: number, b: number) {
    [this.items[a], this.items[b]] = [this.items[b], this.items[a]];
  }
}
