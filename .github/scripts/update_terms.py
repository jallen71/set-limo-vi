from pathlib import Path

p = Path('terms.html')
s = p.read_text()

def rep(old, new):
    global s
    if old not in s:
        raise SystemExit('Expected terms text not found: ' + old[:80])
    s = s.replace(old, new, 1)

rep('<strong>Last Updated:</strong> April 26, 2026', '<strong>Last Updated:</strong> September 10, 2026')
rep('Superb Executive Transportation provides private executive transportation services in St. Thomas. St. John-related requests, ferry-related transportation, special-event transportation, multi-stop transportation, hourly service, daily service, and other coordinated requests may require additional review before confirmation.', 'Superb Executive Transportation provides three service types: Point-to-Point Transfer, Private Charter, and Multi-Day / On-Call transportation. Weddings, proms, dinners, events, ferry coordination, multiple stops, and similar transportation needs are handled under the service type that best matches the requested trip rather than as separate service categories.')
rep('St. John-related requests are not automatically confirmed through the website. Superb Executive Transportation will review the requested details and contact the customer to confirm whether the service can be coordinated.', 'St. John-related requests and Multi-Day / On-Call transportation require review and confirmation. Superb Executive Transportation will review the requested details and contact the customer to confirm availability, service arrangements, and pricing.')
rep('Service is based on the vehicle capacity available for the confirmed trip. Superb Executive Transportation maintains a hard six-passenger maximum for transportation service.', 'Service is based on the vehicle capacity available for the confirmed trip. The vehicle has a maximum capacity of six passengers, subject to safe luggage and cargo capacity. For passenger comfort, luggage volume may reduce the practical passenger capacity for a particular trip.')
rep('Prices shown on the website, booking page, promotional material, or request form may be estimates or starting prices unless expressly confirmed by Superb Executive Transportation.', 'Point-to-Point Transfer pricing is route-based and may include applicable trip-specific adjustments shown or communicated before confirmation. Private Charter pricing is time-based. Multi-Day / On-Call transportation is individually quoted and requires owner review and confirmation.')
rep('Final pricing may depend on service type, date, time, pickup location, drop-off location, waiting time, ferry coordination, special-event needs, extra stops, return service, after-hours service, delays, customer changes, or other trip-specific details.', 'Final pricing may depend on the selected service type, date, time, pickup and drop-off locations, St. John coordination, return service, passenger count, customer-requested changes, and other trip-specific details. Waiting and multiple stops occurring within confirmed Private Charter reserved time are part of the charter service and are not treated as separate service categories.')
rep('<h2>6. Cancellations, Changes, and No-Shows</h2>', '''<h2>6. Private Charter Service</h2>
      <p>
        Private Charter reserves the vehicle and driver for the customer for a continuous period of time. The charter minimum is $600 and includes up to five hours of reserved service. Time beyond five hours is charged at $120 per hour. When approved and calculated in half-hour increments, an additional half hour is $60.
      </p>
      <p>
        Charter time begins at the confirmed scheduled start time and continues until final release of the vehicle and driver. Waiting, temporary drop-offs, multiple stops, and periods when passengers are away from the vehicle do not stop charter time while the vehicle and driver remain reserved for the customer.
      </p>
      <p>
        A temporary drop-off does not end the charter when the vehicle and driver remain reserved for a later pickup or continued service. The charter ends when the customer gives final release or when the confirmed reserved service concludes, subject to any approved additional time.
      </p>

      <h2>7. Cancellations, Changes, and No-Shows</h2>''')
rep('Standard transfer changes or cancellations require at least 24 hours’ notice before the confirmed pickup time.', 'Point-to-Point Transfer changes or cancellations require at least 24 hours’ notice before the confirmed pickup time.')
rep('St. John-related service, ferry-coordinated service, event service, hourly service, daily service, and multi-stop service require at least 48 hours’ notice because those services require additional coordination.', 'Private Charter, Multi-Day / On-Call transportation, and St. John-related service require at least 48 hours’ notice because those services reserve additional time or require additional coordination.')
for a,b in [(7,8),(8,9),(9,10),(10,11),(11,12),(12,13),(13,14),(14,15),(15,16),(16,17),(17,18)]:
    marker = f'<h2>{a}. '
    pos = s.find(marker)
    if pos < 0:
        raise SystemExit('Missing section ' + str(a))
    s = s[:pos] + s[pos:].replace(marker, f'<h2>{b}. ', 1)

p.write_text(s)
