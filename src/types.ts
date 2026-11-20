export type NoteKind = 'sticky' | 'photo';
export type NoteColor = 'yellow' | 'blue' | 'mint' | 'coral' | 'lavender' | 'paper';
export type StringColor = 'red' | 'gold';
export type ToolMode = 'select' | 'place-sticky' | 'place-photo' | 'connect';
export type CameraPreset = 'room' | 'corkboard' | 'whiteboard';

export interface NoteItem {
  id: string;
  kind: NoteKind;
  u: number;
  v: number;
  color: NoteColor;
  title: string;
  body: string;
  author: string;
  imageData?: string;
  updatedAt?: number;
}

export interface StringConnection {
  id: string;
  fromId: string;
  toId: string;
  color: StringColor;
  createdAt?: number;
}

export interface PeerUser {
  connId?: string;
  id: string;
  name: string;
  color: string;
  avatarUrl?: string;
}

export interface CursorState {
  x: number;
  y: number;
  z: number;
  visible: boolean;
}

export interface ServerMember {
  id: string;
  name: string;
  avatarUrl?: string;
  bot?: boolean;
  online?: boolean;
  isSelf?: boolean;
}

export interface PendingNoteDraft {
  kind: NoteKind;
  color: NoteColor;
  title: string;
  body: string;
  imageData?: string;
  editId?: string;
}
