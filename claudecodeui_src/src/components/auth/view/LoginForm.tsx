import { useCallback, useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import AuthErrorAlert from './AuthErrorAlert';
import AuthInputField from './AuthInputField';
import AuthScreenLayout from './AuthScreenLayout';

type LoginFormState = {
  email: string;
  password: string;
};

const initialState: LoginFormState = {
  email: '',
  password: '',
};

type LoginFormProps = {
  onSwitchToSetup?: () => void;
};

/**
 * Login form component.
 * Handles credential input with browser autofill support (`autocomplete`
 * attributes) so that password managers can offer to fill saved credentials.
 */
export default function LoginForm({ onSwitchToSetup }: LoginFormProps = {}) {
  const { t } = useTranslation('auth');
  const { login } = useAuth();

  const [formState, setFormState] = useState<LoginFormState>(initialState);
  const [errorMessage, setErrorMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const updateField = useCallback((field: keyof LoginFormState, value: string) => {
    setFormState((previous) => ({ ...previous, [field]: value }));
  }, []);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setErrorMessage('');

      // Keep form validation local so each auth screen owns its own UI feedback.
      if (!formState.email.trim() || !formState.password) {
        setErrorMessage(t('login.errors.requiredFields'));
        return;
      }

      setIsSubmitting(true);
      const result = await login(formState.email.trim(), formState.password);
      if (!result.success) {
        setErrorMessage(result.error);
      }
      setIsSubmitting(false);
    },
    [formState.password, formState.email, login, t],
  );

  return (
    <AuthScreenLayout
      title={t('login.title')}
      description={t('login.description')}
      footerText="Enter your credentials to access OptCode"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <AuthInputField
          id="email"
          type="email"
          label={t('login.email', 'Email Address')}
          value={formState.email}
          onChange={(value) => updateField('email', value)}
          placeholder={t('login.placeholders.email', 'Enter your email address')}
          isDisabled={isSubmitting}
          autoComplete="email"
        />

        <AuthInputField
          id="password"
          label={t('login.password')}
          value={formState.password}
          onChange={(value) => updateField('password', value)}
          placeholder={t('login.placeholders.password')}
          isDisabled={isSubmitting}
          type="password"
          autoComplete="current-password"
        />

        <AuthErrorAlert errorMessage={errorMessage} />

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-md bg-blue-600 px-4 py-2 font-medium text-white transition-colors duration-200 hover:bg-blue-700 disabled:bg-blue-400"
        >
          {isSubmitting ? t('login.loading') : t('login.submit')}
        </button>

        {onSwitchToSetup && (
          <div className="mt-4 text-center text-sm text-muted-foreground">
            Don't have an account?{' '}
            <button
              type="button"
              onClick={onSwitchToSetup}
              className="text-blue-600 hover:underline dark:text-blue-400"
            >
              Sign up
            </button>
          </div>
        )}
      </form>
    </AuthScreenLayout>
  );
}
