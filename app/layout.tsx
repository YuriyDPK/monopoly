import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'Monopoly Club — играйте вместе', description: 'Онлайн-игра для друзей. Создавайте компании, торгуйте и побеждайте.' };
export default function RootLayout({ children }: LayoutProps<'/'>) { return <html lang="ru"><body>{children}</body></html>; }
