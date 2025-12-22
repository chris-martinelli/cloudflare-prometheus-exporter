import { graphql } from "./client";

export const HTTPMetricsQuery = graphql(`
  query HTTPMetrics(
    $zoneIDs: [string!]
    $mintime: Time!
    $maxtime: Time!
    $limit: uint64!
  ) {
    viewer {
      zones(filter: { zoneTag_in: $zoneIDs }) {
        zoneTag
        httpRequests1mGroups(
          limit: $limit
          filter: { datetime_geq: $mintime, datetime_lt: $maxtime }
        ) {
          uniq {
            uniques
          }
          sum {
            browserMap {
              pageViews
              uaBrowserFamily
            }
            bytes
            cachedBytes
            cachedRequests
            contentTypeMap {
              bytes
              requests
              edgeResponseContentTypeName
            }
            countryMap {
              bytes
              clientCountryName
              requests
              threats
            }
            encryptedBytes
            encryptedRequests
            pageViews
            requests
            responseStatusMap {
              edgeResponseStatus
              requests
            }
            threatPathingMap {
              requests
              threatPathingName
            }
            threats
            clientHTTPVersionMap {
              clientHTTPProtocol
              requests
            }
            clientSSLMap {
              clientSSLProtocol
              requests
            }
            ipClassMap {
              ipType
              requests
            }
          }
          dimensions {
            datetime
          }
        }
        firewallEventsAdaptiveGroups(
          limit: $limit
          filter: { datetime_geq: $mintime, datetime_lt: $maxtime }
        ) {
          count
          dimensions {
            action
            source
            ruleId
            clientRequestHTTPHost
            clientCountryName
            botScore
            botScoreSrcName
          }
        }
      }
    }
  }
`);

export const HTTPMetricsQueryNoBots = graphql(`
  query HTTPMetricsNoBots(
    $zoneIDs: [string!]
    $mintime: Time!
    $maxtime: Time!
    $limit: uint64!
  ) {
    viewer {
      zones(filter: { zoneTag_in: $zoneIDs }) {
        zoneTag
        httpRequests1mGroups(
          limit: $limit
          filter: { datetime_geq: $mintime, datetime_lt: $maxtime }
        ) {
          uniq {
            uniques
          }
          sum {
            browserMap {
              pageViews
              uaBrowserFamily
            }
            bytes
            cachedBytes
            cachedRequests
            contentTypeMap {
              bytes
              requests
              edgeResponseContentTypeName
            }
            countryMap {
              bytes
              clientCountryName
              requests
              threats
            }
            encryptedBytes
            encryptedRequests
            pageViews
            requests
            responseStatusMap {
              edgeResponseStatus
              requests
            }
            threatPathingMap {
              requests
              threatPathingName
            }
            threats
            clientHTTPVersionMap {
              clientHTTPProtocol
              requests
            }
            clientSSLMap {
              clientSSLProtocol
              requests
            }
            ipClassMap {
              ipType
              requests
            }
          }
          dimensions {
            datetime
          }
        }
        firewallEventsAdaptiveGroups(
          limit: $limit
          filter: { datetime_geq: $mintime, datetime_lt: $maxtime }
        ) {
          count
          dimensions {
            action
            source
            ruleId
            clientRequestHTTPHost
            clientCountryName
          }
        }
      }
    }
  }
`);

export const FirewallMetricsQuery = graphql(`
  query FirewallMetrics(
    $zoneIDs: [string!]
    $mintime: Time!
    $maxtime: Time!
    $limit: uint64!
  ) {
    viewer {
      zones(filter: { zoneTag_in: $zoneIDs }) {
        zoneTag
        firewallEventsAdaptiveGroups(
          limit: $limit
          filter: { datetime_geq: $mintime, datetime_lt: $maxtime }
        ) {
          count
          dimensions {
            action
            source
            ruleId
            clientRequestHTTPHost
            clientCountryName
          }
        }
      }
    }
  }
`);

export const HealthCheckMetricsQuery = graphql(`
  query HealthCheckMetrics(
    $zoneIDs: [string!]
    $mintime: Time!
    $maxtime: Time!
    $limit: uint64!
  ) {
    viewer {
      zones(filter: { zoneTag_in: $zoneIDs }) {
        zoneTag
        healthCheckEventsAdaptiveGroups(
          limit: $limit
          filter: { datetime_geq: $mintime, datetime_lt: $maxtime }
        ) {
          count
          avg {
            rttMs
            timeToFirstByteMs
            tcpConnMs
            tlsHandshakeMs
          }
          dimensions {
            healthStatus
            originIP
            region
            fqdn
            failureReason
          }
        }
      }
    }
  }
`);

export const AdaptiveMetricsQuery = graphql(`
  query AdaptiveMetrics(
    $zoneIDs: [string!]
    $mintime: Time!
    $maxtime: Time!
    $limit: uint64!
  ) {
    viewer {
      zones(filter: { zoneTag_in: $zoneIDs }) {
        zoneTag
        httpRequestsAdaptiveGroups(
          limit: $limit
          filter: {
            datetime_geq: $mintime
            datetime_lt: $maxtime
            cacheStatus_notin: ["hit"]
            originResponseStatus_in: [
              400
              404
              500
              502
              503
              504
              522
              523
              524
            ]
          }
        ) {
          count
          dimensions {
            originResponseStatus
            clientCountryName
            clientRequestHTTPHost
          }
          avg {
            originResponseDurationMs
          }
        }
      }
    }
  }
`);

export const EdgeCountryMetricsQuery = graphql(`
  query EdgeCountryMetrics(
    $zoneIDs: [string!]
    $mintime: Time!
    $maxtime: Time!
    $limit: uint64!
  ) {
    viewer {
      zones(filter: { zoneTag_in: $zoneIDs }) {
        zoneTag
        httpRequestsEdgeCountryHost: httpRequestsAdaptiveGroups(
          limit: $limit
          filter: { datetime_geq: $mintime, datetime_lt: $maxtime }
        ) {
          count
          dimensions {
            edgeResponseStatus
            clientCountryName
            clientRequestHTTPHost
          }
        }
      }
    }
  }
`);

export const ColoMetricsQuery = graphql(`
  query ColoMetrics(
    $zoneIDs: [string!]
    $mintime: Time!
    $maxtime: Time!
    $limit: uint64!
  ) {
    viewer {
      zones(filter: { zoneTag_in: $zoneIDs }) {
        zoneTag
        httpRequestsAdaptiveGroups(
          limit: $limit
          filter: { datetime_geq: $mintime, datetime_lt: $maxtime }
        ) {
          count
          avg {
            sampleInterval
          }
          dimensions {
            clientRequestHTTPHost
            coloCode
            datetime
            originResponseStatus
          }
          sum {
            edgeResponseBytes
            visits
          }
        }
      }
    }
  }
`);

export const ColoErrorMetricsQuery = graphql(`
  query ColoErrorMetrics(
    $zoneIDs: [string!]
    $mintime: Time!
    $maxtime: Time!
    $limit: uint64!
  ) {
    viewer {
      zones(filter: { zoneTag_in: $zoneIDs }) {
        zoneTag
        httpRequestsAdaptiveGroups(
          limit: $limit
          filter: {
            datetime_geq: $mintime
            datetime_lt: $maxtime
            edgeResponseStatus_geq: 400
          }
        ) {
          count
          dimensions {
            clientRequestHTTPHost
            coloCode
            edgeResponseStatus
          }
          sum {
            edgeResponseBytes
            visits
          }
        }
      }
    }
  }
`);

export const WorkerTotalsQuery = graphql(`
  query WorkerTotals(
    $accountID: string!
    $mintime: Time!
    $maxtime: Time!
    $limit: uint64!
  ) {
    viewer {
      accounts(filter: { accountTag: $accountID }) {
        workersInvocationsAdaptive(
          limit: $limit
          filter: { datetime_geq: $mintime, datetime_lt: $maxtime }
        ) {
          dimensions {
            scriptName
            status
          }
          sum {
            requests
            errors
            duration
          }
          quantiles {
            cpuTimeP50
            cpuTimeP75
            cpuTimeP99
            cpuTimeP999
            durationP50
            durationP75
            durationP99
            durationP999
          }
        }
      }
    }
  }
`);

// Note: Cloudflare's accounts filter only supports single accountTag, not accountTag_in
// Use WorkerTotalsQuery for individual account queries

export const LoadBalancerMetricsQuery = graphql(`
  query LoadBalancerMetrics(
    $zoneIDs: [string!]
    $mintime: Time!
    $maxtime: Time!
    $limit: uint64!
  ) {
    viewer {
      zones(filter: { zoneTag_in: $zoneIDs }) {
        zoneTag
        loadBalancingRequestsAdaptiveGroups(
          filter: { datetime_geq: $mintime, datetime_lt: $maxtime }
          limit: $limit
        ) {
          count
          dimensions {
            lbName
            selectedPoolName
            selectedOriginName
            region
            proxied
            selectedPoolAvgRttMs
            selectedPoolHealthy
            steeringPolicy
            numberOriginsSelected
          }
        }
        loadBalancingRequestsAdaptive(
          filter: { datetime_geq: $mintime, datetime_lt: $maxtime }
          limit: $limit
        ) {
          lbName
          pools {
            id
            poolName
            healthy
            healthCheckEnabled
            avgRttMs
          }
        }
      }
    }
  }
`);

export const LogpushAccountMetricsQuery = graphql(`
  query LogpushAccountMetrics(
    $accountID: string!
    $limit: uint64!
    $mintime: Time!
    $maxtime: Time!
  ) {
    viewer {
      accounts(filter: { accountTag: $accountID }) {
        logpushHealthAdaptiveGroups(
          filter: {
            datetime_geq: $mintime
            datetime_lt: $maxtime
            status_neq: 200
          }
          limit: $limit
        ) {
          count
          dimensions {
            jobId
            status
            destinationType
            datetime
            final
          }
        }
      }
    }
  }
`);

// Note: Cloudflare's accounts filter only supports single accountTag, not accountTag_in
// Use LogpushAccountMetricsQuery for individual account queries

export const LogpushZoneMetricsQuery = graphql(`
  query LogpushZoneMetrics(
    $zoneIDs: [string!]
    $limit: uint64!
    $mintime: Time!
    $maxtime: Time!
  ) {
    viewer {
      zones(filter: { zoneTag_in: $zoneIDs }) {
        zoneTag
        logpushHealthAdaptiveGroups(
          filter: {
            datetime_geq: $mintime
            datetime_lt: $maxtime
            status_neq: 200
          }
          limit: $limit
        ) {
          count
          dimensions {
            jobId
            status
            destinationType
            datetime
            final
          }
        }
      }
    }
  }
`);

export const MagicTransitMetricsQuery = graphql(`
  query MagicTransitMetrics(
    $accountID: string!
    $limit: uint64!
    $mintime: Time!
    $maxtime: Time!
  ) {
    viewer {
      accounts(filter: { accountTag: $accountID }) {
        magicTransitTunnelHealthChecksAdaptiveGroups(
          limit: $limit
          filter: { datetime_geq: $mintime, datetime_lt: $maxtime }
        ) {
          count
          dimensions {
            active
            datetime
            edgeColoCity
            edgeColoCountry
            edgePopName
            remoteTunnelIPv4
            resultStatus
            siteName
            tunnelName
          }
        }
      }
    }
  }
`);

// Note: Cloudflare's accounts filter only supports single accountTag, not accountTag_in
// Use MagicTransitMetricsQuery for individual account queries

export const RequestMethodMetricsQuery = graphql(`
  query RequestMethodMetrics(
    $zoneIDs: [string!]
    $mintime: Time!
    $maxtime: Time!
    $limit: uint64!
  ) {
    viewer {
      zones(filter: { zoneTag_in: $zoneIDs }) {
        zoneTag
        httpRequestsAdaptiveGroups(
          limit: $limit
          filter: { datetime_geq: $mintime, datetime_lt: $maxtime }
        ) {
          count
          dimensions {
            clientRequestHTTPMethodName
          }
        }
      }
    }
  }
`);

export const OriginStatusMetricsQuery = graphql(`
  query OriginStatusMetrics(
    $zoneIDs: [string!]
    $mintime: Time!
    $maxtime: Time!
    $limit: uint64!
  ) {
    viewer {
      zones(filter: { zoneTag_in: $zoneIDs }) {
        zoneTag
        httpRequestsAdaptiveGroups(
          limit: $limit
          filter: { datetime_geq: $mintime, datetime_lt: $maxtime }
        ) {
          count
          dimensions {
            originResponseStatus
            clientCountryName
            clientRequestHTTPHost
          }
        }
      }
    }
  }
`);

export const CacheMissMetricsQuery = graphql(`
  query CacheMissMetrics(
    $zoneIDs: [string!]
    $mintime: Time!
    $maxtime: Time!
    $limit: uint64!
  ) {
    viewer {
      zones(filter: { zoneTag_in: $zoneIDs }) {
        zoneTag
        httpRequestsAdaptiveGroups(
          filter: {
            datetime_geq: $mintime
            datetime_lt: $maxtime
            cacheStatus: "miss"
          }
          limit: $limit
        ) {
          count
          avg {
            originResponseDurationMs
          }
          dimensions {
            clientCountryName
            clientRequestHTTPHost
          }
        }
      }
    }
  }
`);
