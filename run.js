#!/usr/bin/which node

const VERBOSE = true;

const ASSERT = require("assert");
const UTIL = require("util");
const PATH = require("path");
const FS = require("fs-extra");
const YAML = require("yamljs");
const LODASH = require("lodash");
const TRAVERSE = require("traverse");
const REQUEST = require("request-promise-native");
const EAPPLY = require("eapply");


function log (label, obj) {
    if (VERBOSE) console.error(`[it.pinf.com.digitalocean] ${label}:`, UTIL.inspect(obj, false, 4, true));
}


// Connect to pod and run test request:
//   kubectl exec -it php-fpm-alpine-54f4f9cd7-gj57v -- wget -O- http://127.0.0.1:8000/

const DECLARATIONS = {
    "@clusters": {
        "gi0-cadorn-org-workspace": {
            "name": "gi0-cadorn-org-workspace",
            "region": "nyc1",
            "version": "1.14.1-do.2",
            "node_pools": [
                {
                    "size": "s-1vcpu-2gb",
                    "count": 2,
                    "name": "gi0-cadorn-org-workspace-worker-pool"
                }
            ],
            "@kubeconfig": {
                "@deployments": {
                    "php-fpm-alpine": {
                        "kind": "Deployment",
                        "spec": {
                            "replicas": 1,
                            "template": {
                                "spec": {
                                    "containers": [
                                        {
                                            "image": "crccheck/hello-world",
                                            "name": "php-fpm-alpine",
                                            "ports": [
                                                {
                                                    "containerPort": 8000
                                                }
                                            ]
                                        }
                                    ]
                                },
                                "metadata": {
                                    "labels": {
                                        "app": "php-fpm-alpine"
                                    }
                                }
                            },
                            "selector": {
                                "matchLabels": {
                                    "app": "php-fpm-alpine"
                                }
                            }
                        },
                        "apiVersion": "apps/v1",
                        "metadata": {
                            "labels": {
                                "app": "php-fpm-alpine"
                            },
                            "name": "php-fpm-alpine"
                        }
                    }
                },
                "@services": {
                    "php-fpm-alpine-web": {
                        "apiVersion": "v1",
                        "kind": "Service",
                        "metadata": {
                            "name": "php-fpm-alpine-web"
                        },
                        "spec": {
                            "type": "LoadBalancer",
                            "ports": [
                                {
                                    "protocol": "TCP",
                                    "port": 80,
                                    "targetPort": 8000,
                                    "name": "http"
                                }
                            ],
                            "selector": {
                                "app": "php-fpm-alpine"
                            }
                        },
                        "@tests": {
                            "01-HelloWorld": {
                                "impl": "Hello_World"
                            }
                        }
                    }
                }
            }
        }
    }
};



// @see https://github.com/matt-major/do-wrapper
// @see https://github.com/matt-major/do-wrapper/blob/master/docs/do-wrapper.md
// @see https://developers.digitalocean.com/documentation/v2/#kubernetes
const DigitalOcean = require('do-wrapper').default;
// TODO: Make token configurable.
const api = new DigitalOcean(process.env.DigitalOcean_gi0_cadorn_org, 100);


class DigitalOcean_Domains_Handler {
    constructor () {
        const self = this;
        self['#'] = 'DigitalOcean_Domains_Handler';
        self.get = async function () {
            // @see https://github.com/matt-major/do-wrapper/blob/master/docs/do-wrapper.md#domainsGetAll
            const { domains } = (await api.domainsGetAll()).body;
            return {
                items: LODASH.keyBy(domains, 'name')
            };
        }
    }
}

class DigitalOcean_Clusters_Handler {
    constructor () {
        const self = this;
        self['#'] = 'DigitalOcean_Clusters_Handler';
        self.get = async function () {
            try {
                // @see https://github.com/matt-major/do-wrapper/blob/master/docs/do-wrapper.md#kubernetes
                const { kubernetes_clusters } = (await api.kubernetes()).body;

                return {
                    items: LODASH.keyBy(kubernetes_clusters, 'name'),
                    propertyOptions: {
                        "id": "IMMUTABLE_RESPONSE",
                        "cluster_subnet": "IMMUTABLE_RESPONSE",
                        "service_subnet": "IMMUTABLE_RESPONSE",
                        "vpc_uuid": "IMMUTABLE_RESPONSE",
                        "ipv4": "IMMUTABLE_RESPONSE",
                        "endpoint": "IMMUTABLE_RESPONSE",
                        "auto_upgrade": "IMMUTABLE_RESPONSE",
                        "tags": [
                            function IMMUTABLE_RESPONSE (value) {
                                return /^k8s(:|$)/.test(value);
                            }
                        ],
                        "node_pools": [
                            {
                                "id": "IMMUTABLE_RESPONSE",
                                "tags": [
                                    function IMMUTABLE_RESPONSE (value) {
                                        return /^k8s(:|$)/.test(value);
                                    }
                                ],        
                                "nodes": "IMMUTABLE_RESPONSE"
                            }
                        ],
                        "maintenance_policy": "IMMUTABLE_RESPONSE",
                        "status": "IMMUTABLE_RESPONSE",
                        "created_at": "IMMUTABLE_RESPONSE",
                        "updated_at": "IMMUTABLE_RESPONSE"
                    }
                };
            } catch (err) {
                // TODO: Trigger 1 re-run.
                throw err;
                //throw new Error(`Kubernetes does not seem to be enabled for account. Enable it at: https://cloud.digitalocean.com/kubernetes/clusters`);
            }
        }
        self.create = async function (name, config) {
            if (config.name !== config.name) {
                throw new Error(`Name in config '${config.name}' must match declaration object key '${name}'!`);
            }
            // @see https://github.com/matt-major/do-wrapper/blob/master/docs/do-wrapper.md#kubernetescreateclusterclusterdata-callback--promise--undefined
            const { kubernetes_cluster } = (await api.kubernetesCreateCluster(config)).body;
            return kubernetes_cluster;
        }
        self.delete = async function (name, config) {
            // @see https://github.com/matt-major/do-wrapper/blob/master/docs/do-wrapper.md#kubernetesClusterDelete
            (await api.kubernetesClusterDelete(config.id));
            return null;
        }
        self.update = async function (name, config, parent) {

// TODO: Support changes to 'node_pool'
            throw new Error(`Cannot update cluster '${name}'. Remove and re-create it or change its name.`);
        }
    }
}


class DigitalOcean_Cluster_Kubeconfig_Handler {
    constructor () {
        const self = this;
        self['#'] = 'DigitalOcean_Cluster_Kubeconfig_Handler';
        self.get = async function (parents, path) {
            try {
                // Wait until cluster is provisioned.
                await new Promise(function (resolve, reject) {
                    async function check () {
                        try {

                            log(`Checking if cluster with 'id' is responsive`, parents['@clusters'].id);

                            const { kubernetes_cluster } = (await api.kubernetesClusterGet(parents['@clusters'].id)).body;

                            if (typeof kubernetes_cluster.status === 'object') {
                                if (kubernetes_cluster.status.state === 'running') {
                                    // Cluster is available.
                                    resolve(null);
                                    clearInterval(checkInterval);
                                } else {
                                    log(`... got cluster state:`, kubernetes_cluster.status.state);
                                }
                            }
                        } catch (err) {
                            reject(err);
                            clearInterval(checkInterval);
                        }
                    }
                    const checkInterval = setInterval(check, 10 * 1000);
                    check();
                });

                const configYAML = (await api.kubernetesClusterGetConfig(parents['@clusters'].id)).body;
                const configObject = LODASH.merge({
                    contexts: [
                        {
                            name: "dev",
                            context: {
                                cluster: path.slice(0, -1).pop(),
                                namespace: "default"
                            }
                        }
                    ],
                    'current-context': "dev"    
                }, YAML.parse(configYAML));

                const kybeConfigPath = PATH.join(process.cwd(), '.~kube', parents['@clusters'].id, 'config');
                FS.outputFileSync(kybeConfigPath, YAML.stringify(configObject), 'utf8');

                //process.env.KUBECONFIG = kybeConfigPath;
                console.log(`export KUBECONFIG=${kybeConfigPath}`);

                // @see https://github.com/godaddy/kubernetes-client
                // @see https://github.com/godaddy/kubernetes-client/blob/master/docs/1.13/README.md
                // @see https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.14/
                const KUBERNETES = require('kubernetes-client');
                const client = new KUBERNETES.Client({
                    config: KUBERNETES.config.fromKubeconfig(configObject),
                    version: '1.9'
                });


                // Wait until cluster is reachable and up.
                await new Promise(function (resolve, reject) {
                    async function check () {
                        try {

                            log(`Checking if cluster with 'id' is ready`, parents['@clusters'].id);

                            const { items } = (await client.api.v1.nodes.get()).body;

                            // At least two nodes.
                            if (items.length < 2) {
                                log(`... got less than two nodes:`, items.length);
                                return;
                            }

                            const readyNodes = items.filter(function (item) {
                                return (LODASH.get(item, ['status', 'addresses'], []).filter(function (address) {
                                    return (address.type === 'InternalIP');
                                }).length === 1);
                            }).length;
                            if (readyNodes < 2) {
                                log(`... got less than two ready nodes:`, readyNodes);
                                return;
                            }

                            // Cluster is ready.
                            resolve(null);
                            clearInterval(checkInterval);

                        } catch (err) {
                            reject(err);
                            clearInterval(checkInterval);
                        }
                    }
                    const checkInterval = setInterval(check, 10 * 1000);
                    check();
                });

                return {
                    configObject: configObject,
                    client: Object.create(client)
                };
            } catch (err) {
                // TODO: Trigger 1 re-run.
                throw err;
            }
        }
    }
}

class Kubernetes_Deployments_Handler {
    constructor () {
        const self = this;
        self['#'] = 'Kubernetes_Deployments_Handler';
        self.get = async function (parents) {
            const deployments = (await parents['@kubeconfig'].client.apis.apps.v1beta1.deployments.get()).body.items;
            return {
                items: LODASH.keyBy(deployments, function (item) {
                    return item.metadata.name;
                }),
                ignoreKeys: [
                    "kube-dns",
                    "cilium-operator",
                    "coredns"
                ],
                propertyOptions: {
                    "apiVersion": "CREATE_ONLY",
                    "kind": "CREATE_ONLY",
                    "metadata": {
                        "namespace": "IMMUTABLE_RESPONSE",
                        "selfLink": "IMMUTABLE_RESPONSE",
                        "uid": "IMMUTABLE_RESPONSE",
                        "resourceVersion": "IMMUTABLE_RESPONSE",
                        "generation": "IMMUTABLE_RESPONSE",
                        "creationTimestamp": "IMMUTABLE_RESPONSE",
                        "annotations": "IMMUTABLE_RESPONSE"
                    },
                    "spec": {
                        "template": {
                            "metadata": {
                                "creationTimestamp": "IMMUTABLE_RESPONSE"
                            },
                            "spec": {
                                "containers": [
                                    {
                                        "ports": [
                                            {
                                                "protocol": "IMMUTABLE_RESPONSE"
                                            }
                                        ],
                                        "resources": "IMMUTABLE_RESPONSE",
                                        "terminationMessagePath": "IMMUTABLE_RESPONSE",
                                        "terminationMessagePolicy": "IMMUTABLE_RESPONSE",
                                        "imagePullPolicy": "IMMUTABLE_RESPONSE"
                                    }
                                ],
                                "restartPolicy": "IMMUTABLE_RESPONSE",
                                "dnsPolicy": "IMMUTABLE_RESPONSE",
                                "terminationGracePeriodSeconds": "IMMUTABLE_RESPONSE",
                                "securityContext": "IMMUTABLE_RESPONSE",
                                "schedulerName": "IMMUTABLE_RESPONSE"                
                            }
                        },
                        "strategy": "IMMUTABLE_RESPONSE",
                        "restartPolicy": "IMMUTABLE_RESPONSE",
                        "revisionHistoryLimit": "IMMUTABLE_RESPONSE",
                        "progressDeadlineSeconds": "IMMUTABLE_RESPONSE"
                    },
                    "status": "IMMUTABLE_RESPONSE"
                }
            };
        }
        self.create = async function (name, config, parents) {            
            const namespace = parents['@kubeconfig'].configObject.contexts.filter(function (context) {
                return (context.name === parents['@kubeconfig'].configObject['current-context']);
            })[0].context.namespace;

            return (await parents['@kubeconfig'].client.apis.apps.v1.namespace(namespace).deployments.post({
                body: config
            })).body;
        }
        self.delete = async function (name, config, parents) {
            const namespace = parents['@kubeconfig'].configObject.contexts.filter(function (context) {
                return (context.name === parents['@kubeconfig'].configObject['current-context']);
            })[0].context.namespace;

            await parents['@kubeconfig'].client.apis.apps.v1.namespace(namespace).deployment(name).delete();            
            return null;
        }
        self.update = async function (name, config, parents) {
            const namespace = parents['@kubeconfig'].configObject.contexts.filter(function (context) {
                return (context.name === parents['@kubeconfig'].configObject['current-context']);
            })[0].context.namespace;

            return (await parents['@kubeconfig'].client.apis.apps.v1beta1.namespace(namespace).deployment(name).put({
                body: config
            })).body;
        }
    }
}

class Kubernetes_Services_Handler {
    constructor () {
        const self = this;
        self['#'] = 'Kubernetes_Services_Handler';
        self.get = async function (parents) {

            let result = null;

            // Wait until services have IPs
            await new Promise(function (resolve, reject) {
                async function check () {
                    try {

                        const services = (await parents['@kubeconfig'].client.api.v1.services.get()).body.items;

                        const found = services.filter(function (item) {
                            return !!LODASH.get(item, ['status', 'loadBalancer', 'ingress', 0, 'ip']);
                        });

                        if (found.length !== (services.length -2)) {
                            log(`... no IP(s) available yet`, `${found.length} / ${services.length - 2}`);
                            return;
                        }

                        result = {
                            items: LODASH.keyBy(services, function (item) {
                                return item.metadata.name;
                            }),
                            ignoreKeys: [
                                "kubernetes",
                                "kube-dns"
                            ],
                            propertyOptions: {
                                "apiVersion": "CREATE_ONLY",
                                "kind": "CREATE_ONLY",
                                "metadata": {
                                    "namespace": "IMMUTABLE_RESPONSE",
                                    "selfLink": "IMMUTABLE_RESPONSE",
                                    "uid": "IMMUTABLE_RESPONSE",
                                    "resourceVersion": "IMMUTABLE_RESPONSE",
                                    "creationTimestamp": "IMMUTABLE_RESPONSE"
                                },
                                "spec": {
                                    "clusterIP": "IMMUTABLE_RESPONSE",
                                    "sessionAffinity": "IMMUTABLE_RESPONSE",
                                    "externalTrafficPolicy": "IMMUTABLE_RESPONSE",
                                    "ports": [
                                        {
                                            "nodePort": "IMMUTABLE_RESPONSE"
                                        }
                                    ]
                                },
                                "status": "IMMUTABLE_RESPONSE"
                            }
                        };
                        resolve(null);
                        clearInterval(checkInterval);
                    } catch (err) {
                        reject(err);
                        clearInterval(checkInterval);
                    }
                }
                const checkInterval = setInterval(check, 10 * 1000);
                check();
            });            

            return result;
        }
        self.create = async function (name, config, parents) {
            const namespace = parents['@kubeconfig'].configObject.contexts.filter(function (context) {
                return (context.name === parents['@kubeconfig'].configObject['current-context']);
            })[0].context.namespace;

            return (await parents['@kubeconfig'].client.api.v1.namespace(namespace).services.post({
                body: config
            })).body;
        }
        self.delete = async function (name, config, parents) {
            const namespace = parents['@kubeconfig'].configObject.contexts.filter(function (context) {
                return (context.name === parents['@kubeconfig'].configObject['current-context']);
            })[0].context.namespace;

            await parent.client.api.v1.namespace(namespace).services(name).delete();
            return null;
        }
        self.update = async function (name, config, parents, existingConfig) {
            const namespace = parents['@kubeconfig'].configObject.contexts.filter(function (context) {
                return (context.name === parents['@kubeconfig'].configObject['current-context']);
            })[0].context.namespace;

            config = LODASH.merge({
                "metadata": {
                    "resourceVersion": existingConfig.metadata.resourceVersion
                },
                "spec": {
                    "clusterIP": existingConfig.spec.clusterIP
                }
            }, config);

            return (await parents['@kubeconfig'].client.api.v1.namespaces(namespace).services(name).put({
                body: config
            })).body;
        }
    }
}



class Tests_Handler {
    constructor () {
        const self = this;
        self['#'] = 'Tests_Handler';
        self.get = async function (parents, path) {
            // TODO: Add expected config to arguments.

            if (parents['@services']) {

                // Wait until load balancer is returning expected payload
                await new Promise(function (resolve, reject) {
                    async function check () {
                        try {

                            const loadBalancerIP = LODASH.get(parents, ['@services', 'status', 'loadBalancer', 'ingress', 0, 'ip']);

                            log(`Checking if load balancer with 'ip' is responsive`, loadBalancerIP);

                            const response = await REQUEST({
                                uri: `http://${loadBalancerIP}/`,
                                timeout: 3 * 1000,
                                resolveWithFullResponse: true
                            });

                            // TODO: Make response checking configurable.

                            if (response.statusCode === 200) {
                                resolve(null);
                                clearInterval(checkInterval);
                            } else {
                                log(`... got status code:`, response.statusCode);
                            }
                        } catch (err) {
                            reject(err);
                            clearInterval(checkInterval);
                        }
                    }
                    const checkInterval = setInterval(check, 10 * 1000);
                    check();
                });

                return {
                    propertyOptions: {
                        "impl": "CREATE_ONLY",
                        "success": "IMMUTABLE_RESPONSE"
                    },
                    items: {
                        "01-HelloWorld": {
                            "success": true
                        }
                    }
                };    
            }

            return {
                items: {}
            };
        }
    }
}


async function main () {

    const { account } = (await api.account()).body;
    
    log("Account", account);

    const result = await EAPPLY.apply(DECLARATIONS, {
        "@domains": new DigitalOcean_Domains_Handler(),
        "@clusters": new DigitalOcean_Clusters_Handler(),    
        "@kubeconfig": new DigitalOcean_Cluster_Kubeconfig_Handler(),
        "@deployments": new Kubernetes_Deployments_Handler(),
        "@services": new Kubernetes_Services_Handler(),
        "@tests": new Tests_Handler()
    });

console.log("RESULT", JSON.stringify(result, null, 4));

    ASSERT.deepEqual(result.configAfter['@clusters/gi0-cadorn-org-workspace/@kubeconfig/@services/php-fpm-alpine-web/@tests'], {
        "01-HelloWorld": {
            "success": true
        }
    });

    const loadBalancerIP = LODASH.get(result.configAfter, ['@clusters/gi0-cadorn-org-workspace/@kubeconfig/@services', 'php-fpm-alpine-web', 'status', 'loadBalancer', 'ingress', 0, 'ip']);

    console.log("Deployment is up:", `http://${loadBalancerIP}/`);
}


try {
    main().catch(function (err) {
        throw err;
    });
} catch (err) {
    console.error(err.stack || err);
    process.exit(1);
}
