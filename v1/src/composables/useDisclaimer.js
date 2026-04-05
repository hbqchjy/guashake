import { ref } from 'vue'

const STORAGE_KEY = 'guashake_disclaimer_accepted'

export function useDisclaimer() {
  const accepted = ref(!!localStorage.getItem(STORAGE_KEY))

  function accept() {
    localStorage.setItem(STORAGE_KEY, Date.now().toString())
    accepted.value = true
  }

  return { accepted, accept }
}
