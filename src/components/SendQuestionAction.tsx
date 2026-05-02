'use client';

import { Send } from 'lucide-react';
import { useState } from 'react';

import { SendQuestionDrawer, type SendableQuestion } from '@/components/SendQuestionDrawer';

type SendQuestionActionProps = {
  question: SendableQuestion;
  onSent?: () => void;
  label?: string;
  className?: string;
};

export function SendQuestionAction({
  question,
  onSent,
  label = 'Send to friend',
  className = 'inline-flex min-h-10 items-center gap-2 rounded-md border px-3 text-sm hover:bg-muted',
}: SendQuestionActionProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button className={className} type="button" onClick={() => setOpen(true)} title="Send to friend">
        <Send className="size-4" />
        {label ? <span>{label}</span> : null}
      </button>
      <SendQuestionDrawer
        isOpen={open}
        onClose={() => setOpen(false)}
        question={question}
        onSent={onSent}
      />
    </>
  );
}
