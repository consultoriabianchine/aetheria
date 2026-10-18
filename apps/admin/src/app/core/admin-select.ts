import { Component, ElementRef, HostListener, Input, Output, EventEmitter, ViewChild, signal } from '@angular/core';

export interface AdminSelectOption {
  value: string;
  label: string;
}

let nextSelectId = 0;

@Component({
  selector: 'admin-select',
  templateUrl: './admin-select.html',
  styles: `
    :host { position: relative; display: block; min-width: 0; }
    .trigger { display: flex; align-items: center; justify-content: space-between; gap: 10px; width: 100%; min-height: 38px; padding: 8px 10px; text-align: left; color: var(--admin-text); background: rgba(8, 11, 17, .72); border: 1px solid var(--admin-border); border-radius: var(--admin-radius-sm); }
    .trigger:hover:not(:disabled), .trigger.open { background: var(--admin-surface-raised); border-color: var(--admin-border-strong); transform: none; }
    .trigger:focus-visible { outline: 2px solid var(--admin-gold-bright); outline-offset: 2px; }
    .trigger:disabled { opacity: .55; cursor: not-allowed; }
    .trigger-label.placeholder { color: var(--admin-text-subtle); }
    .chevron { color: var(--admin-gold); font-size: 14px; transition: transform .16s ease; }
    .trigger.open .chevron { transform: rotate(180deg); }
    .menu { position: absolute; z-index: 30; top: calc(100% + 5px); left: 0; right: 0; max-height: 240px; overflow-y: auto; padding: 5px; background: var(--admin-surface-raised); border: 1px solid var(--admin-border-strong); border-radius: var(--admin-radius-sm); box-shadow: var(--admin-shadow-modal); }
    .option { display: flex; align-items: center; width: 100%; padding: 9px 10px; text-align: left; color: var(--admin-text-muted); background: transparent; border: 0; border-radius: 3px; }
    .option:hover, .option.active { color: var(--admin-text); background: rgba(220, 174, 77, .12); }
    .option.selected { color: var(--admin-gold-bright); }
    .option:focus-visible { outline: 2px solid var(--admin-gold-bright); outline-offset: -2px; }
    @media (prefers-reduced-motion: reduce) { .chevron { transition: none; } }
  `,
})
export class AdminSelect {
  @Input() options: AdminSelectOption[] = [];
  @Input() value = '';
  @Input() placeholder = 'Selecione uma opção';
  @Input() disabled = false;
  @Output() readonly valueChange = new EventEmitter<string>();

  readonly open = signal(false);
  readonly activeIndex = signal(-1);
  readonly menuId = `admin-select-${++nextSelectId}`;
  @ViewChild('trigger') private trigger?: ElementRef<HTMLButtonElement>;
  @ViewChild('menu') private menu?: ElementRef<HTMLDivElement>;

  get selectedLabel(): string {
    return this.options.find((option) => option.value === this.value)?.label ?? this.placeholder;
  }

  toggle(event?: Event) {
    event?.stopPropagation();
    if (this.disabled) return;
    if (this.open()) this.close();
    else this.openMenu();
  }

  openMenu() {
    if (this.disabled || this.options.length === 0) return;
    this.open.set(true);
    const selected = this.options.findIndex((option) => option.value === this.value);
    this.activeIndex.set(selected >= 0 ? selected : 0);
    this.focusMenu();
  }

  close() {
    this.open.set(false);
    this.activeIndex.set(-1);
    queueMicrotask(() => this.trigger?.nativeElement.focus());
  }

  select(option: AdminSelectOption, event?: Event) {
    event?.stopPropagation();
    this.valueChange.emit(option.value);
    this.close();
  }

  onTriggerKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (this.open() && this.activeIndex() >= 0) this.select(this.options[this.activeIndex()]);
      else this.toggle();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!this.open()) this.openMenu();
      else this.move(event.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (event.key === 'Escape' && this.open()) {
      event.preventDefault();
      this.close();
    }
  }

  onMenuKeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      this.move(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      this.activeIndex.set(event.key === 'Home' ? 0 : Math.max(0, this.options.length - 1));
    } else if (event.key === 'Enter' && this.activeIndex() >= 0) {
      event.preventDefault();
      this.select(this.options[this.activeIndex()]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
    }
  }

  private move(step: number) {
    if (this.options.length === 0) return;
    const next = this.activeIndex() < 0 ? 0 : this.activeIndex() + step;
    this.activeIndex.set((next + this.options.length) % this.options.length);
  }

  private focusMenu() {
    queueMicrotask(() => this.menu?.nativeElement.focus());
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    if (!this.open() || (event.target instanceof Node && this.elementContains(event.target))) return;
    this.close();
  }

  private elementContains(target: Node): boolean {
    return (target as Element).closest?.('admin-select') !== null;
  }
}
