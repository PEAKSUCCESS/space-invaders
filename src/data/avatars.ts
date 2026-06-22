import type { AvatarId } from '../types';

export interface Avatar {
  id: AvatarId;
  name: string;
  imageUrl: string;
  fallbackEmoji: string;
  fallbackColor: string;
}

export const avatars: Avatar[] = [
  { id: 'Clay', name: 'Clay', imageUrl: '/avatars/Clay.png', fallbackEmoji: '🍎', fallbackColor: '#e63946' },
  { id: 'Ivy', name: 'Ivy', imageUrl: '/avatars/Ivy.png', fallbackEmoji: '🍊', fallbackColor: '#f4a261' },
  { id: 'Jade', name: 'Jade', imageUrl: '/avatars/Jade.png', fallbackEmoji: '🍋', fallbackColor: '#ffd166' },
  { id: 'Reed', name: 'Reed', imageUrl: '/avatars/Reed.png', fallbackEmoji: '🍉', fallbackColor: '#8ac926' },
];

export function avatarById(id: AvatarId): Avatar {
  return avatars.find((a) => a.id === id) ?? avatars[0];
}
