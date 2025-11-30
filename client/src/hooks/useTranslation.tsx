import { useState, useEffect } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';

/**
 * Hook for translating text in components
 * Returns both the translated text and a loading state
 */
export function useTranslation(text: string) {
  const { currentLanguage, t } = useLanguage();
  const [translated, setTranslated] = useState(text);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (currentLanguage === 'en') {
      setTranslated(text);
      return;
    }

    setIsLoading(true);
    t(text)
      .then(result => {
        setTranslated(result);
        setIsLoading(false);
      })
      .catch(() => {
        setTranslated(text);
        setIsLoading(false);
      });
  }, [text, currentLanguage, t]);

  return { translated, isLoading };
}

/**
 * Component wrapper for translating text
 */
export function T({ children }: { children: string }) {
  const { translated } = useTranslation(children);
  return <>{translated}</>;
}
