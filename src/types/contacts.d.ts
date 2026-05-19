interface ContactInfo {
  name?: string[]
  tel?: string[]
}

interface ContactsManager {
  select(
    props: Array<'name' | 'tel' | 'email' | 'address' | 'icon'>,
    options?: { multiple?: boolean }
  ): Promise<ContactInfo[]>
  getProperties(): Promise<
    Array<'name' | 'tel' | 'email' | 'address' | 'icon'>
  >
}

interface Navigator {
  contacts?: ContactsManager
}

interface Window {
  ContactsManager?: unknown
}
