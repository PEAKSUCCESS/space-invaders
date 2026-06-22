import { useState } from 'react';
import type { Avatar } from '../data/avatars';

interface Props {
  avatar: Avatar;
  size?: number;
  selected?: boolean;
  onClick?: () => void;
}

export function AvatarBadge({ avatar, size = 96, selected, onClick }: Props) {
  const [imgFailed, setImgFailed] = useState(false);
  const interactive = typeof onClick === 'function';
  return (
    <button
      type={interactive ? 'button' : undefined}
      className={`avatar-badge${selected ? ' selected' : ''}${interactive ? ' interactive' : ''}`}
      onClick={onClick}
      style={{
        width: size,
        height: size,
        background: imgFailed ? avatar.fallbackColor : 'transparent',
      }}
      aria-label={avatar.name}
    >
      {imgFailed ? (
        <span className="avatar-fallback" style={{ fontSize: size * 0.55 }}>{avatar.fallbackEmoji}</span>
      ) : (
        <img
          src={avatar.imageUrl}
          alt={avatar.name}
          width={size}
          height={size}
          onError={() => setImgFailed(true)}
          draggable={false}
        />
      )}
    </button>
  );
}
