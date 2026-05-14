import type { TypedFeedItem } from './types'

export const mockTypedFeedItems: TypedFeedItem[] = [
  {
    type: 'direct_sent',
    id: 'mock-direct-sent',
    senderName: 'Maya',
    metadata: 'Maya sent this · Today',
    category: 'Food & Drink',
    question: 'Which fermented tea is often kept alive by a SCOBY?',
    personalMessage: 'This felt like your kind of kitchen lore.',
  },
  {
    type: 'friend_answered',
    id: 'mock-friend-answered',
    friendName: 'Noah',
    friendCorrect: true,
    metadata: 'Noah got this right · Yesterday',
    category: 'Science',
    question: 'What kind of celestial object is a magnetar?',
    answerSummary:
      'A pale green shell marks correct friend answers as common ground.',
  },
  {
    type: 'friend_added',
    id: 'mock-friend-added',
    friendName: 'Ari',
    metadata: 'Ari wrote a question · May 9',
    category: 'History',
    question: 'What treaty formally ended World War I for Germany?',
  },
  {
    type: 'friend_liked',
    id: 'mock-friend-liked',
    friendName: 'Sam',
    metadata: 'Sam liked this · May 8',
    category: null,
    question: 'Which instrument family does the oboe belong to?',
  },
  {
    type: 'answered_by_you',
    id: 'mock-answered-by-you',
    metadata: 'You answered · May 7',
    category: 'General Knowledge',
    question: 'Which city hosted the 1992 Summer Olympics?',
    resultLabel: 'Answered by you',
    answerSummary:
      'Muted gray is reserved for questions you have already answered.',
  },
]
