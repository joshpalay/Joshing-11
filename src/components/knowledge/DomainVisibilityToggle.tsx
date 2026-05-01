'use client';

import { useState } from 'react';

type Props = {
  userId: string;
  domainName: string;
  initialVisible: boolean;
};

export function DomainVisibilityToggle({ userId, domainName, initialVisible }: Props) {
  const [isVisible, setIsVisible] = useState(initialVisible);
  const [isSaving, setIsSaving] = useState(false);

  const label = isVisible ? 'Visible' : 'Private';

  const onToggle = async () => {
    if (isSaving) return;
    const next = !isVisible;
    setIsVisible(next);
    setIsSaving(true);

    try {
      const res = await fetch(`/api/users/${userId}/knowledge/${encodeURIComponent(domainName)}/visibility`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ isVisible: next }),
      });

      if (!res.ok) {
        setIsVisible(!next);
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <button type="button" className="btn-secondary" onClick={onToggle} disabled={isSaving}>
      Show this domain on my profile: {label}
    </button>
  );
}
