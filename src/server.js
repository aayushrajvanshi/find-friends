import express from 'express';
const app = express();
import bodyParser from 'body-parser';
import morgan from 'morgan';
import mongoose from 'mongoose';
import axios from 'axios';
import jwt from 'jsonwebtoken';
import config from './config';
import cors from 'cors';

app.use(cors());

var User = require('./app/models/user');
var Mapping = require('./app/models/mapping');
var Location = require('./app/models/location');

const port = process.env.PORT || 8080;
mongoose.connect(config.database);
app.set('superSecret', config.secret);

app.use(bodyParser.urlencoded({
    extended: false
}));
app.use(bodyParser.json());

app.use(morgan('dev'));

var apiRoutes = express.Router();

apiRoutes.post('/login', function (req, res) {
    User.findOne({
        email_id: req.body.email_id
    }, (err, user) => {
        if (err) throw err;
        if (!user) {
            let newUser = new User({
                name: req.body.name,
                pic_url: req.body.pic_url,
                google_id: req.body.google_id,
                gcm_key: req.body.gcm_key,
                email_id: req.body.email_id,
                access_token: ''
            });

            let token = jwt.sign(newUser, app.get('superSecret'), {
                expiresIn: "86400000"
            });

            newUser.access_token = token;
            newUser.save((err) => {
                if (err) throw err;
                console.log('User saved successfully');
                res.json({
                    success: true,
                    message: 'User Added.',
                    token: token
                });
            });
        } else {
            user.access_token = '';
            let token = jwt.sign(user, app.get('superSecret'), {
                expiresIn: "86400000"
            });
            User.update({
                email_id: user.email_id
            }, {
                gcm_key: req.body.gcm_key,
                access_token: token
            }, {
                upsert: true
            }, (err) => {
                if (err) throw err;
                else {
                    res.json({
                        success: true,
                        token: token
                    });
                }
            });
        }
    });
});

apiRoutes.use((req, res, next) => {
    let token = req.body.token || req.query.token || req.headers['x-access-token'];
    if (token) {

        jwt.verify(token, app.get('superSecret'), (err, decoded) => {
            if (err) {
                return res.json({
                    success: false,
                    success_code: '401',
                    message: 'Failed to authenticate token.'
                });
            } else {
                req.decoded = decoded;
                next();
            }
        });
    } else {
        return res.status(403).send({
            success: false,
            success_code: '401',
            message: 'No token provided.'
        });

    }
});

apiRoutes.post('/connect-friend', (req, res) => {
    let friend_email_id = req.body.friend_email_id;
    User.findOne({
        email_id: friend_email_id
    }, (err, user) => {
        if (err) throw err;
        if (!user) {
            res.json({
                success: true,
                status_code: 501,
                message: 'Friend does not exists'
            });
        } else {
            res.json({
                success: true,
                status_code: 200,
                message: 'Push Notification sent to User'
            });
        }
    });
});

apiRoutes.post('/friend-request', (req, res) => {
    let token = req.body.token || req.query.token || req.headers['x-access-token'];
    let email_id = req.body.email_id;
    let status = req.body.status;
    if (status === 'Accepted') {
        User.findOne({
            access_token: token
        }, (err, user) => {
            if (err) throw err;
            let mapping = new Mapping({
                email_id: email_id,
                friend_email_id: user.email_id
            });
            mapping.save((err) => {
                if (err) throw err;
                console.log('Mapping saved successfully');
                res.json({
                    success: 502,
                    message: 'Request Accepted'
                });
            });
        });
    } else if (status === 'Denied') {
        res.json({
            success: 503,
            message: 'Request Denied'
        });
    } else {
        res.json({
            success: 503,
            message: 'Data not provided'
        });
    }
});

apiRoutes.post('/disconnect', (req, res) => {
    let token = req.body.token || req.query.token || req.headers['x-access-token'];
    let friend_email_id = req.body.friend_email_id;
    if (!friend_email_id) {
        User.findOne({
            access_token: token
        }, (err, user) => {
            if (err) throw err;
            User.findOne({
                email_id: user.email_id
            }, (err, user) => {
                if (err) throw err;
                Mapping.remove({
                    email_id: user.email_id
                }, (err) => {
                    if (err) throw err;
                    res.json({
                        status: 501,
                        message: 'All friends disconnected'
                    });
                });
            })
        });
    } else {
        User.findOne({
            access_token: token
        }, (err, user) => {
            if (err) throw err;
            User.findOne({
                email_id: user.email_id
            }, (err, user) => {
                if (err) throw err;
                Mapping.remove({
                    email_id: user.email_id,
                    friend_email_id: friend_email_id
                }, (err) => {
                    if (err) throw err;
                    res.json({
                        status: 501,
                        message: 'Friend disconnected'
                    });
                });
            })
        });
    }
});

apiRoutes.get('/get-connected', (req, res) => {
    let token = req.body.token || req.query.token || req.headers['x-access-token'];
    User.findOne({
        access_token: token
    }, (err, user) => {
        if (err) throw err;
        Mapping.find({
            email_id: user.email_id
        }, (err, data) => {
            let friend = [];
            data.map(o => User.find({
                email_id: o.friend_email_id
            }, (err, user) => {
                if (err) throw err;
                if (user) {
                    friend.push(user.map(o => ({
                        'name': o.name,
                        'pic_url': o.pic_url,
                        'email_id': o.email_id,
                    })));
                }
            }));
            setTimeout(() => {
                res.json({
                    success: true,
                    status_code: 501,
                    data: friend
                })
            }, 1000);
        })

    });
});

apiRoutes.post('/get-friend-location', (req, res) => {
    let friend_email_id = req.body.friend_email_id;
    Location.find({
        email_id: friend_email_id
    }, (err, user) => {
        if (err) throw err;
        if (user.length !== 0) {
            res.json({
                success: true,
                status_code: 501,
                location: user.map(o => ({
                    'latitude': o.latitude,
                    'longitude': o.longitude
                }))
            });
        } else {
            res.json({
                success: false,
                status_code: 503,
                message: 'User not found in location list'
            });
        }
    });
});

apiRoutes.post('/update-my-location', (req, res) => {
    let token = req.body.token || req.query.token || req.headers['x-access-token'];
    let latitude = req.body.latitude;
    let longitude = req.body.longitude;
    User.findOne({
        access_token: token
    }, (err, user) => {
        if (err) throw err;
        Location.findOne({
            email_id: user.email_id
        }, (err, location) => {
            if (err) throw err;
            if (!location) {
                let newLocation = new Location({
                    email_id: user.email_id,
                    latitude: latitude,
                    longitude: longitude
                });
                newLocation.save((err) => {
                    if (err) throw err;
                    console.log('Location saved successfully');
                    res.json({
                        success: true,
                        status_code: 501,
                        message: 'Location Added'
                    });
                });
            } else {
                Location.update({
                    email_id: location.email_id
                }, {
                    latitude: latitude,
                    longitude: longitude
                }, {
                    upsert: true
                }, (err) => {
                    if (err) throw err;
                    else {
                        res.json({
                            success: true,
                            status_code: 501,
                            message: 'Location Updated'
                        });
                    }
                });
            }
        })
    });
});

app.use('/api', apiRoutes);

app.listen(port);
console.log('Server started at http://localhost:' + port);