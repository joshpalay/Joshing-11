import { Fragment } from 'react';

import { assignCaption, bucketMoments, formatMomentTime } from '@/lib/lately';
import type { LatelyMoment } from '@/server/db/queries/lately';

import { DayDivider } from './DayDivider';
import { MomentRow } from './MomentRow';
import { FS, INK2 } from './tokens';

type Props = {
  moments: LatelyMoment[];
  tz: string;
};

export function LatelyFeed({ moments, tz }: Props) {
  if (moments.length === 0) {
    return (
      <div
        style={{
          fontFamily: FS,
          fontStyle: 'italic',
          fontSize: 16,
          color: INK2,
          textAlign: 'center',
          paddingTop: 40,
        }}
      >
        No moments yet. They&rsquo;ll appear here once you and your friends start
        answering each other&rsquo;s questions.
      </div>
    );
  }

  const buckets = bucketMoments(moments, tz);
  const featuredId = moments[0]?.momentId;

  return (
    <>
      {buckets.map((bucket) => (
        <Fragment key={bucket.label}>
          <DayDivider label={bucket.label} />
          {bucket.items.map((moment) => (
            <MomentRow
              key={moment.momentId}
              moment={moment}
              caption={assignCaption(moment.momentId, moment.dir, moment.friendFirstName)}
              footnoteTime={formatMomentTime(moment.answeredAt, bucket.label, tz)}
              featured={moment.momentId === featuredId}
              defaultOpen={moment.momentId === featuredId}
            />
          ))}
        </Fragment>
      ))}
    </>
  );
}
