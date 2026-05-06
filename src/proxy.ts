import { NextResponse, type NextRequest } from 'next/server';

type AuthMeResponse = {
  user?: {
    onboardingComplete?: boolean;
  };
};

async function getAuthenticatedUser(request: NextRequest): Promise<AuthMeResponse['user'] | null> {
  const response = await fetch(new URL('/api/auth/me', request.url), {
    headers: {
      cookie: request.headers.get('cookie') ?? '',
    },
    cache: 'no-store',
  }).catch(() => null);

  if (!response?.ok) return null;

  const data = (await response.json().catch(() => null)) as AuthMeResponse | null;
  return data?.user ?? null;
}

export async function proxy(request: NextRequest) {
  if (request.method === 'OPTIONS') {
    return new NextResponse(null, { status: 200 });
  }

  const { pathname } = request.nextUrl;
  const isLoginPage = pathname === '/login';
  const isOnboardingPage = pathname === '/onboarding';
  const isAllowedOnboardingPath =
    isOnboardingPage ||
    pathname === '/logout' ||
    pathname.startsWith('/api/onboarding/') ||
    pathname.startsWith('/api/auth/');

  const user = await getAuthenticatedUser(request);

  if (!user) {
    if (isLoginPage) return NextResponse.next();

    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.search = '';
    return NextResponse.redirect(loginUrl);
  }

  if (!user.onboardingComplete && !isAllowedOnboardingPath) {
    const onboardingUrl = request.nextUrl.clone();
    onboardingUrl.pathname = '/onboarding';
    onboardingUrl.search = '';
    return NextResponse.redirect(onboardingUrl);
  }

  if (user.onboardingComplete && (isLoginPage || isOnboardingPage)) {
    const homeUrl = request.nextUrl.clone();
    homeUrl.pathname = '/';
    homeUrl.search = '';
    return NextResponse.redirect(homeUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
