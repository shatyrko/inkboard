<script setup lang="ts">
// One Icon component with a name -> component map: the app uses semantic names, swapping the set is one file.
// Add new icons by appending to the map below (keep names kebab-case, one per line).
import { computed } from 'vue';
import {
  Activity, ArrowDown, ArrowUp, ArrowRightLeft, Battery, BatteryCharging, BatteryFull, BookOpen, Bookmark, Calendar, Camera, Check, ChevronDown,
  ChevronRight, CircleCheck, Clock, ClipboardPaste, Copy, CopyPlus, Cpu, Download, Ellipsis, Eye, File, FilePlus, FileText, Folder, FolderOpen,
  FolderPlus, Gauge, Globe, GripVertical, HardDrive, Hash, Heading, Image, ImagePlus, Info, KeyRound, Layers, LayoutDashboard, Library, Link,
  ListChecks, Lock, MemoryStick, Minus, Monitor, Moon, Move, Newspaper, Notebook, Palette, Pause, Pen, Pencil, Play, Plug, Plus, Power, Quote,
  Radar, Redo2, RefreshCw, Rows3, Save, ScreenShare, Scissors, Search, Send, Settings, Shapes, SlidersHorizontal, Square, StickyNote, Sun,
  Tablet, Terminal, TextSelect, Timer, Trash2, TriangleAlert, Type, Undo2, Unplug, Upload, Wand2, Wifi, WifiOff, X, ZoomIn,
  ArrowLeft, ArrowRight,
  BringToFront, Grid3x3, Maximize, PanelLeft, SendToBack, ZoomOut,
} from 'lucide-vue-next';

const map: Record<string, any> = {
  activity: Activity, 'arrow-down': ArrowDown, 'arrow-up': ArrowUp, move: ArrowRightLeft, battery: Battery, 'battery-charging': BatteryCharging,
  'battery-full': BatteryFull, book: BookOpen, bookmark: Bookmark, calendar: Calendar, camera: Camera, check: Check, 'chevron-down': ChevronDown,
  'chevron-right': ChevronRight, ok: CircleCheck, clock: Clock, 'clipboard-paste': ClipboardPaste, copy: Copy, duplicate: CopyPlus, cpu: Cpu,
  download: Download, more: Ellipsis, eye: Eye, file: File, 'file-plus': FilePlus, 'file-text': FileText, folder: Folder, 'folder-open': FolderOpen,
  'folder-plus': FolderPlus, gauge: Gauge, globe: Globe, grip: GripVertical, drive: HardDrive, hash: Hash, heading: Heading, image: Image,
  'image-plus': ImagePlus, info: Info, key: KeyRound, layers: Layers, dashboard: LayoutDashboard, library: Library, link: Link, checklist: ListChecks,
  lock: Lock, memory: MemoryStick, minus: Minus, monitor: Monitor, moon: Moon, drag: Move, news: Newspaper, notebook: Notebook, palette: Palette,
  pause: Pause, pen: Pen, edit: Pencil, play: Play, plug: Plug, plus: Plus, power: Power, quote: Quote, radar: Radar, redo: Redo2, refresh: RefreshCw,
  rows: Rows3, save: Save, show: ScreenShare, scissors: Scissors, search: Search, send: Send, settings: Settings, shapes: Shapes, sliders: SlidersHorizontal,
  square: Square, note: StickyNote, sun: Sun, device: Tablet, terminal: Terminal, 'text-select': TextSelect, timer: Timer, trash: Trash2,
  warn: TriangleAlert, type: Type, undo: Undo2, unplug: Unplug, upload: Upload, wand: Wand2, wifi: Wifi, 'wifi-off': WifiOff, x: X, zoom: ZoomIn,
  'arrow-left': ArrowLeft, 'arrow-right': ArrowRight,
  'bring-front': BringToFront, grid: Grid3x3, fit: Maximize, 'panel-left': PanelLeft, 'send-back': SendToBack, 'zoom-out': ZoomOut,
};

const props = withDefaults(defineProps<{ name: string; size?: number; fill?: boolean }>(), { size: 18, fill: false });
const comp = computed(() => map[props.name] ?? Info);
</script>

<template>
  <component :is="comp" :size="size" :stroke-width="1.9" :fill="fill ? 'currentColor' : 'none'" aria-hidden="true" />
</template>
