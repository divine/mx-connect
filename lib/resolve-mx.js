'use strict';

const dns = require('dns');
const net = require('net');
const dnsErrors = require('./dns-errors');
const tools = require('./tools');

function resolveMX(delivery) {
    return new Promise((resolve, reject) => {
        let firstError = false;
        let addressFound = false;
        let dnsOptions = delivery.dnsOptions || {
            ignoreIPv6: false,
            resolve: dns.resolve
        };

        let filterAddress = ip => {
            let invalid = tools.isInvalid(delivery, ip);
            if (invalid) {
                if (!firstError) {
                    firstError = new Error(
                        'Can not send mail to the resolved IP address [' +
                            ip +
                            '] of the MX server for ' +
                            delivery.domain +
                            (typeof invalid === 'string' ? '. ' + invalid : '')
                    );
                    firstError.response = '550 ' + firstError.message;
                    firstError.category = 'dns';
                }
            } else {
                addressFound = true;
            }
            return !invalid;
        };

        // Do not try to resolve the domain name if it is an IP address
        if (delivery.isIp) {
            if (!filterAddress(delivery.decodedDomain) && firstError) {
                return reject(firstError);
            }

            delivery.mx = [
                {
                    priority: 0,
                    exchange: delivery.decodedDomain,
                    A: net.isIPv4(delivery.decodedDomain) ? [delivery.decodedDomain] : [],
                    AAAA: net.isIPv6(delivery.decodedDomain) && !dnsOptions.ignoreIPv6 ? [delivery.decodedDomain] : []
                }
            ];
            return resolve(delivery);
        }

        let domain = delivery.decodedDomain;

        dnsOptions.resolve(domain, 'MX', (err, list) => {
            if (err && err.code !== 'ENODATA' && err.code !== 'ENOTFOUND') {
                err.category = 'dns';
                err.message = 'DNS error when resolving MX server for ' + domain + ': ' + (dnsErrors[err.code] || err.message);
                err.response = '450 ' + err.message;
                err.temporary = true; // this might be a temporary issue with DNS
                return reject(err);
            }

            if (!list || !list.length) {
                // fallback to A
                return dnsOptions.resolve(domain, (err, list) => {
                    if (err && err.code !== 'ENODATA' && err.code !== 'ENOTFOUND') {
                        err.message = 'DNS error when resolving MX server for ' + domain + ': ' + (dnsErrors[err.code] || err.message);
                        err.response = '450 ' + err.message;
                        err.category = 'dns';
                        return reject(err);
                    }

                    if (!list || (!list.length && !dnsOptions.ignoreIPv6)) {
                        // fallback to AAAA
                        return dnsOptions.resolve(domain, 'AAAA', (err, list) => {
                            if (err && err.code !== 'ENODATA' && err.code !== 'ENOTFOUND') {
                                err.message = 'DNS error when resolving MX server for ' + domain + ': ' + (dnsErrors[err.code] || err.message);
                                err.response = '450 ' + err.message;
                                err.category = 'dns';
                                return reject(err);
                            }

                            if (!list || !list.length) {
                                // nothing found!
                                err = err || new Error('No MX server found');
                                err.message = 'DNS error when resolving MX server for ' + domain + ': ' + (dnsErrors[err.code] || err.message);
                                err.response = '550 ' + err.message;
                                err.category = 'dns';
                                return reject(err);
                            }

                            delivery.mx = [].concat(list || []).map(entry => ({
                                priority: 0,
                                exchange: domain,
                                mx: false,
                                A: [],
                                AAAA: [entry].filter(filterAddress)
                            }));
                            if (!addressFound && firstError) {
                                return reject(firstError);
                            }
                            return resolve(delivery);
                        });
                    }

                    delivery.mx = [].concat(list || []).map(entry => ({
                        priority: 0,
                        exchange: domain,
                        mx: false,
                        A: [entry].filter(filterAddress),
                        AAAA: []
                    }));
                    if (!addressFound && firstError) {
                        return reject(firstError);
                    }
                    return resolve(delivery);
                });
            }

            delivery.mx = []
                .concat(list || [])
                .sort((a, b) => a.priority - b.priority)
                .map(entry => {
                    entry.mx = true;
                    entry.A = [];
                    entry.AAAA = [];
                    return entry;
                });
            return resolve(delivery);
        });
    });
}

module.exports = resolveMX;
