import Hero from '@/components/home/Hero'
import InfoStrip from '@/components/home/InfoStrip'
import SignatureSection from '@/components/home/SignatureSection'
import PullQuoteBand from '@/components/home/PullQuoteBand'
import AboutTeaser from '@/components/home/AboutTeaser'
import LocationsTeaser from '@/components/home/LocationsTeaser'

export default function Home() {
  return (
    <main>
      <Hero />
      <InfoStrip />
      <SignatureSection />
      <PullQuoteBand />
      <AboutTeaser />
      <LocationsTeaser />
    </main>
  )
}
